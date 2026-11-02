'use client';

import { ApiError, uuidv7 } from '@eeasy-logistics/contracts/http';
import { zodResolver } from '@hookform/resolvers/zod';
import { createContext, use, useCallback, useId, useState, type ReactNode } from 'react';
import {
  FormProvider,
  useController,
  useForm,
  useFormContext,
  type ControllerRenderProps,
  type DefaultValues,
  type FieldPath,
  type FieldValues,
  type Resolver,
  type UseFormReturn,
} from 'react-hook-form';
import type { z } from 'zod';
import { retryAfterSeconds, useErrorMessage } from '../auth/error-message';
import { Button, type ButtonProps } from '../components/button/button';
import { Label } from '../components/label/label';
import { cn } from '../cn';
import { useTranslations } from '../intl';
import { useUnsavedState } from '../session/session-provider';

/** The react-hook-form types a page's sections name, so apps need no direct dependency. */
export type { FieldValues, UseFormReturn } from 'react-hook-form';

// Forms of the signed-in groups (web §6.3, §7.4; WEB-3 plan 2.3): react-hook-form with the
// generated Zod body of the operation as resolver, the field messages of the `errors` catalogue,
// `validation_failed` pointers mapped onto the fields, one `Idempotency-Key` per intent, the
// unsaved state registered with the session, and PATCH bodies of the changed fields only.

/** The field codes of the `errors` catalogue (`errors.fields`). */
export const fieldCodes = [
  'required',
  'invalid',
  'too_short',
  'too_long',
  'breached',
  'owner_gate',
] as const;
export type FieldCode = (typeof fieldCodes)[number];

const isFieldCode = (value: unknown): value is FieldCode =>
  typeof value === 'string' && (fieldCodes as readonly string[]).includes(value);

/** A Zod issue as a field code: the message the form shows instead of Zod's English text. */
export function fieldCodeOf(issue: {
  code: string;
  input?: unknown;
  origin?: string;
  minimum?: unknown;
}): FieldCode {
  const empty = issue.input === undefined || issue.input === null || Number.isNaN(issue.input);
  if (empty) return 'required';
  if (issue.origin === 'string') {
    if (issue.code === 'too_small') return issue.input === '' ? 'required' : 'too_short';
    if (issue.code === 'too_big') return 'too_long';
  }
  return 'invalid';
}

/**
 * `zodResolver` with every issue's message replaced by its field code, so `FormField` shows the
 * catalogue's text in the page's language (Zod's own messages are English).
 */
export function fieldCodeResolver<Schema extends z.ZodType<FieldValues, FieldValues>>(
  schema: Schema,
): Resolver<z.input<Schema>, unknown, z.output<Schema>> {
  return zodResolver(schema, {
    error: (issue) => fieldCodeOf(issue as Parameters<typeof fieldCodeOf>[0]),
  });
}

/**
 * react-hook-form over a generated body schema (or a `.pick()` of it for one section); `disabled`
 * renders every field read-only, for a member who may read but not change (web §4).
 */
export function useContractForm<Schema extends z.ZodType<FieldValues, FieldValues>>(
  schema: Schema,
  defaultValues: DefaultValues<z.input<Schema>>,
  options: { disabled?: boolean } = {},
): UseFormReturn<z.input<Schema>, unknown, z.output<Schema>> {
  return useForm<z.input<Schema>, unknown, z.output<Schema>>({
    resolver: fieldCodeResolver(schema),
    defaultValues,
    mode: 'onTouched',
    disabled: options.disabled,
  });
}

/**
 * The path of a `validation_failed` pointer inside the form: `/body/reason_codes/0/code` is
 * `reason_codes.0.code` (RFC 6901 escapes undone); a pointer outside the body has none.
 */
export function pointerToPath(pointer: string): string | undefined {
  if (!pointer.startsWith('/body/')) return undefined;
  const tokens = pointer
    .slice('/body/'.length)
    .split('/')
    .map((token) => token.replaceAll('~1', '/').replaceAll('~0', '~'));
  return tokens.length === 0 || tokens.some((token) => token === '') ? undefined : tokens.join('.');
}

const anyDirty = (marker: unknown): boolean =>
  marker === true ||
  (Array.isArray(marker) && marker.some(anyDirty)) ||
  (typeof marker === 'object' && marker !== null && Object.values(marker).some(anyDirty));

/**
 * The top-level fields the user changed, whole (a changed reason code sends the list, a changed
 * `proof_policy.cod` sends `proof_policy`): the PATCH body PLAT-12's merge needs (#5, #6).
 */
export function changedValues<Values extends Record<string, unknown>>(
  values: Values,
  dirtyFields: Record<string, unknown>,
): Partial<Values> {
  const changed: Partial<Values> = {};
  for (const key of Object.keys(dirtyFields) as (keyof Values & string)[]) {
    if (anyDirty(dirtyFields[key]) && key in values) changed[key] = values[key];
  }
  return changed;
}

/** The intent's `Idempotency-Key` (web §7.4): kept across retries, renewed after a success. */
export function useIntentKey(): { key: string; renew: () => void } {
  const [key, setKey] = useState(() => uuidv7());
  const renew = useCallback(() => setKey(uuidv7()), []);
  return { key, renew };
}

export interface SubmitContext<Values> {
  /** The top-level fields the user changed: what a PATCH sends. */
  readonly changed: Partial<Values>;
  /** Send as `Idempotency-Key` (`headers` of the generated call). */
  readonly idempotencyKey: string;
}

interface FormStatus {
  readonly failure: string | null;
  readonly blocked: boolean;
  readonly saved: boolean;
}

const FormStatusContext = createContext<FormStatus>({
  failure: null,
  blocked: false,
  saved: false,
});

/**
 * A form bound to `form`: the submit validates, calls `onSubmit` with the parsed values, the
 * changed fields and the intent's key, and maps a refusal onto the fields (`validation_failed`)
 * or the form (anything else; `rate_limited` also holds the submit for `Retry-After`). While the
 * form has edits the session keeps the page through a re-sign-in. `onSubmit` resets the form to
 * what the API answered.
 */
export function Form<Values extends FieldValues, Output extends FieldValues>({
  form,
  onSubmit,
  children,
  className,
  'aria-labelledby': labelledBy,
}: {
  form: UseFormReturn<Values, unknown, Output>;
  onSubmit: (values: Output, context: SubmitContext<Output>) => Promise<unknown>;
  children: ReactNode;
  className?: string;
  'aria-labelledby'?: string;
}) {
  const intent = useIntentKey();
  const errorMessage = useErrorMessage();
  const t = useTranslations('errors');
  const [status, setStatus] = useState<FormStatus>({ failure: null, blocked: false, saved: false });
  // Read in render: react-hook-form tracks only the form state a component reads.
  const { isDirty, dirtyFields, defaultValues } = form.formState;
  useUnsavedState(isDirty);

  const submit = form.handleSubmit(async (values) => {
    setStatus({ failure: null, blocked: false, saved: false });
    try {
      await onSubmit(values, {
        changed: changedValues(values, dirtyFields as Record<string, unknown>),
        idempotencyKey: intent.key,
      });
      intent.renew();
      setStatus({ failure: null, blocked: false, saved: true });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'validation_failed') {
        const unmapped = applyFieldProblems(form, error, defaultValues ?? {});
        setStatus({
          failure: unmapped ? t('codes.validation_failed') : null,
          blocked: false,
          saved: false,
        });
        return;
      }
      const wait = error instanceof ApiError ? retryAfterSeconds(error) : undefined;
      setStatus({ failure: errorMessage(error), blocked: wait !== undefined, saved: false });
      if (wait !== undefined) {
        window.setTimeout(
          () => setStatus((current) => ({ ...current, blocked: false })),
          wait * 1000,
        );
      }
    }
  });

  return (
    <FormProvider {...form}>
      <FormStatusContext value={status}>
        <form
          noValidate
          aria-labelledby={labelledBy}
          aria-busy={form.formState.isSubmitting}
          className={cn('flex flex-col gap-4', className)}
          onSubmit={(event) => void submit(event)}
        >
          {children}
        </form>
      </FormStatusContext>
    </FormProvider>
  );
}

/**
 * Sets each `details.fields[]` problem on its field; true when one has no field in this form
 * (its pointer is outside the body, or names a field the form does not hold).
 */
function applyFieldProblems<Values extends FieldValues>(
  form: UseFormReturn<Values, unknown, FieldValues>,
  error: ApiError,
  defaults: object,
): boolean {
  const problems = Array.isArray(error.details?.fields) ? error.details.fields : [];
  let unmapped = problems.length === 0;
  let first = true;
  for (const problem of problems as { pointer?: unknown; code?: unknown }[]) {
    const path = typeof problem.pointer === 'string' ? pointerToPath(problem.pointer) : undefined;
    const top = path?.split('.')[0];
    if (path === undefined || top === undefined || !(top in defaults)) {
      unmapped = true;
      continue;
    }
    form.setError(
      path as FieldPath<Values>,
      { type: 'server', message: isFieldCode(problem.code) ? problem.code : 'invalid' },
      { shouldFocus: first },
    );
    first = false;
  }
  return unmapped;
}

/**
 * The form's submit button and its status line: disabled until the form has a change (unless
 * `requireChange` is false), busy while the write is in flight, held while `rate_limited` waits;
 * the failure of the last submit and "Saved" after a success are announced next to it.
 */
export function SubmitButton({
  children,
  requireChange = true,
  className,
  ...props
}: Omit<ButtonProps, 'type'> & { requireChange?: boolean }) {
  const { formState } = useFormContext();
  const status = use(FormStatusContext);
  const t = useTranslations('common.form');
  const busy = formState.isSubmitting;
  const disabled = busy || status.blocked || (requireChange && !formState.isDirty);
  return (
    <div className={cn('flex flex-wrap items-center gap-3', className)}>
      <Button type="submit" disabled={disabled} aria-busy={busy} {...props}>
        {busy ? t('saving') : (children ?? t('save'))}
      </Button>
      <p role="status" className="text-sm text-muted-foreground">
        {status.saved && !formState.isDirty ? t('saved') : null}
      </p>
      {status.failure !== null ? (
        <p role="alert" className="w-full text-sm text-danger">
          {status.failure}
        </p>
      ) : null}
    </div>
  );
}

/** The catalogue message of a field error (its `message` holds a field code). */
export function useFieldMessage(): (message: string | undefined) => string | undefined {
  const t = useTranslations('errors.fields');
  return useCallback(
    (message: string | undefined) =>
      message === undefined ? undefined : t(isFieldCode(message) ? message : 'invalid'),
    [t],
  );
}

export interface FieldControl<
  Values extends FieldValues,
  Name extends FieldPath<Values>,
> extends ControllerRenderProps<Values, Name> {
  readonly id: string;
  readonly 'aria-invalid': boolean;
  readonly 'aria-describedby': string | undefined;
}

/**
 * One field: label, the control `children` renders from `control`, an optional description and
 * the error, wired with `aria-invalid` and `aria-describedby` (web §6.3).
 */
export function FormField<Values extends FieldValues, Name extends FieldPath<Values>>({
  name,
  label,
  description,
  className,
  children,
}: {
  name: Name;
  label: ReactNode;
  description?: ReactNode;
  className?: string;
  children: (control: FieldControl<Values, Name>) => ReactNode;
}) {
  const { field, fieldState } = useController<Values, Name>({ name });
  const message = useFieldMessage()(fieldState.error?.message);
  const id = useId();
  const describedBy =
    [description ? `${id}-description` : undefined, message ? `${id}-error` : undefined]
      .filter(Boolean)
      .join(' ') || undefined;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      {children({
        ...field,
        id,
        'aria-invalid': message !== undefined,
        'aria-describedby': describedBy,
      })}
      {description ? (
        <p id={`${id}-description`} className="text-sm text-muted-foreground">
          {description}
        </p>
      ) : null}
      {message ? (
        <p id={`${id}-error`} className="text-sm text-danger">
          {message}
        </p>
      ) : null}
    </div>
  );
}

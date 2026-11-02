'use client';

import { dir } from '@eeasy-logistics/i18n';
import { useId, type ComponentProps, type ReactNode } from 'react';
import { useController, type FieldPath, type FieldValues } from 'react-hook-form';
import { DisabledWithReason } from '../authz/can';
import { Checkbox } from '../components/checkbox/checkbox';
import { Input } from '../components/input/input';
import { Label } from '../components/label/label';
import { RadioGroup, RadioGroupItem } from '../components/radio-group/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/select/select';
import { Switch } from '../components/switch/switch';
import { cn } from '../cn';
import { useTranslations } from '../intl';
import { FormField, useFieldMessage } from './form';

// The field components of `Form` (web §6.3; WEB-3 plan 2.3): WEB-1's Input, Select and the
// bilingual pair, and the Radix Switch, Checkbox group and Radio group, each registered with
// react-hook-form and showing the catalogue's field message under the control.

type InputProps = Omit<
  ComponentProps<'input'>,
  'name' | 'value' | 'onChange' | 'onBlur' | 'id' | 'type' | 'defaultValue'
>;

interface FieldProps<Values extends FieldValues, Name extends FieldPath<Values>> {
  name: Name;
  label: ReactNode;
  description?: ReactNode;
  className?: string;
  disabled?: boolean;
}

/** A text field; pass `dir="ltr"` for codes, emails and phone numbers (web §5). */
export function TextField<Values extends FieldValues, Name extends FieldPath<Values>>({
  name,
  label,
  description,
  className,
  disabled,
  type = 'text',
  input,
}: FieldProps<Values, Name> & { type?: 'text' | 'email'; input?: InputProps }) {
  return (
    <FormField<Values, Name>
      name={name}
      label={label}
      description={description}
      className={className}
    >
      {({ value, ...control }) => (
        <Input
          {...input}
          {...control}
          type={type}
          disabled={disabled ?? control.disabled}
          value={value ?? ''}
        />
      )}
    </FormField>
  );
}

/**
 * Several lines of text (an address, a reason): `dir="auto"` so each value takes the direction of
 * what the user typed (web §5); `maxLength` caps what the browser accepts, the schema still checks.
 */
export function TextAreaField<Values extends FieldValues, Name extends FieldPath<Values>>({
  name,
  label,
  description,
  className,
  disabled,
  rows = 3,
  maxLength,
}: FieldProps<Values, Name> & { rows?: number; maxLength?: number }) {
  return (
    <FormField<Values, Name>
      name={name}
      label={label}
      description={description}
      className={className}
    >
      {({ value, ...control }) => (
        <textarea
          {...control}
          dir="auto"
          rows={rows}
          maxLength={maxLength}
          disabled={disabled ?? control.disabled}
          value={value ?? ''}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger"
        />
      )}
    </FormField>
  );
}

/**
 * A whole number. An empty input holds `NaN`, not undefined: the generated schemas give some
 * numbers a default, which would quietly replace a cleared value; `NaN` fails as `required`.
 * Digits are Western in both languages (ADR-0016), so the input is left to right.
 */
export function NumberField<Values extends FieldValues, Name extends FieldPath<Values>>({
  name,
  label,
  description,
  className,
  disabled,
  min,
  max,
  step = 1,
}: FieldProps<Values, Name> & { min?: number; max?: number; step?: number | 'any' }) {
  return (
    <FormField<Values, Name>
      name={name}
      label={label}
      description={description}
      className={className}
    >
      {({ value, onChange, ...control }) => (
        <Input
          {...control}
          disabled={disabled ?? control.disabled}
          type="number"
          inputMode="numeric"
          dir="ltr"
          lang="en"
          min={min}
          max={max}
          step={step}
          className="max-w-40 text-start"
          value={typeof value === 'number' && !Number.isNaN(value) ? String(value) : ''}
          onChange={(event) => {
            const text = event.target.value;
            onChange(text === '' ? Number.NaN : Number(text));
          }}
        />
      )}
    </FormField>
  );
}

export interface FieldOption {
  readonly value: string;
  readonly label: ReactNode;
  readonly description?: ReactNode;
  readonly disabled?: boolean;
  /**
   * Why a disabled option cannot change (a rule of the API the UI shows, web §4): the checkbox is
   * then wrapped in `DisabledWithReason`, so the reason is its description and its tooltip.
   */
  readonly reason?: ReactNode;
}

/** A select over `options` (Radix Select). */
export function SelectField<Values extends FieldValues, Name extends FieldPath<Values>>({
  name,
  label,
  description,
  className,
  disabled,
  options,
  placeholder,
}: FieldProps<Values, Name> & { options: readonly FieldOption[]; placeholder?: string }) {
  return (
    <FormField<Values, Name>
      name={name}
      label={label}
      description={description}
      className={className}
    >
      {({ value, onChange, onBlur, ref, id, ...control }) => (
        <Select
          value={value ?? ''}
          onValueChange={onChange}
          disabled={disabled ?? control.disabled}
        >
          <SelectTrigger
            ref={ref}
            id={id}
            onBlur={onBlur}
            aria-invalid={control['aria-invalid']}
            aria-describedby={control['aria-describedby']}
          >
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </FormField>
  );
}

/** The shell of a group of choices: a fieldset with its legend, description and error. */
function ChoiceGroup({
  legend,
  description,
  error,
  className,
  children,
}: {
  legend: ReactNode;
  description?: ReactNode;
  error?: string;
  className?: string;
  children: (describedBy: string | undefined) => ReactNode;
}) {
  const id = useId();
  const describedBy =
    [description ? `${id}-description` : undefined, error ? `${id}-error` : undefined]
      .filter(Boolean)
      .join(' ') || undefined;
  return (
    <fieldset className={cn('flex flex-col gap-2', className)} aria-describedby={describedBy}>
      <legend className="mb-1 text-sm font-semibold text-foreground">{legend}</legend>
      {description ? (
        <p id={`${id}-description`} className="text-sm text-muted-foreground">
          {description}
        </p>
      ) : null}
      {children(describedBy)}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

/** One choice of `options` as radios; each option may carry a line that explains it. */
export function RadioGroupField<Values extends FieldValues, Name extends FieldPath<Values>>({
  name,
  label,
  description,
  className,
  disabled,
  options,
}: FieldProps<Values, Name> & { options: readonly FieldOption[] }) {
  const { field, fieldState } = useController<Values, Name>({ name });
  const error = useFieldMessage()(fieldState.error?.message);
  const id = useId();
  return (
    <ChoiceGroup legend={label} description={description} error={error} className={className}>
      {() => (
        <RadioGroup
          ref={field.ref}
          name={field.name}
          value={field.value ?? ''}
          onValueChange={field.onChange}
          onBlur={field.onBlur}
          disabled={disabled ?? field.disabled}
          aria-invalid={error !== undefined}
        >
          {options.map((option) => (
            <div key={option.value} className="flex items-start gap-2">
              <RadioGroupItem
                id={`${id}-${option.value}`}
                value={option.value}
                disabled={option.disabled}
                className="mt-0.5"
              />
              <div className="flex flex-col">
                <Label htmlFor={`${id}-${option.value}`} className="font-normal">
                  {option.label}
                </Label>
                {option.description ? (
                  <span className="text-sm text-muted-foreground">{option.description}</span>
                ) : null}
              </div>
            </div>
          ))}
        </RadioGroup>
      )}
    </ChoiceGroup>
  );
}

/** Several choices of `options` as checkboxes; the value is the list of checked values in order. */
export function CheckboxGroupField<Values extends FieldValues, Name extends FieldPath<Values>>({
  name,
  label,
  description,
  className,
  disabled,
  options,
}: FieldProps<Values, Name> & { options: readonly FieldOption[] }) {
  const { field, fieldState } = useController<Values, Name>({ name });
  const error = useFieldMessage()(fieldState.error?.message);
  const id = useId();
  const checked = new Set((field.value as string[] | undefined) ?? []);
  const toggle = (value: string, on: boolean) => {
    const next = options
      .map((option) => option.value)
      .filter((candidate) => (candidate === value ? on : checked.has(candidate)));
    field.onChange(next);
  };
  return (
    <ChoiceGroup legend={label} description={description} error={error} className={className}>
      {() =>
        options.map((option, index) => {
          const box = (
            <Checkbox
              id={`${id}-${option.value}`}
              ref={index === 0 ? field.ref : undefined}
              checked={checked.has(option.value)}
              disabled={disabled ?? (field.disabled || option.disabled)}
              aria-invalid={error !== undefined}
              onCheckedChange={(state) => toggle(option.value, state === true)}
              onBlur={field.onBlur}
              className="mt-0.5"
            />
          );
          return (
            <div key={option.value} className="flex items-start gap-2">
              {option.reason !== undefined && (option.disabled === true || disabled === true) ? (
                <DisabledWithReason reason={option.reason}>{box}</DisabledWithReason>
              ) : (
                box
              )}
              <div className="flex flex-col">
                <Label htmlFor={`${id}-${option.value}`} className="font-normal">
                  {option.label}
                </Label>
                {option.description ? (
                  <span className="text-sm text-muted-foreground">{option.description}</span>
                ) : null}
              </div>
            </div>
          );
        })
      }
    </ChoiceGroup>
  );
}

/** An on/off setting: the label and its explanation beside the switch. */
export function SwitchField<Values extends FieldValues, Name extends FieldPath<Values>>({
  name,
  label,
  description,
  className,
  disabled,
}: FieldProps<Values, Name>) {
  const { field, fieldState } = useController<Values, Name>({ name });
  const { ref, value, onChange, onBlur } = field;
  const error = useFieldMessage()(fieldState.error?.message);
  const id = useId();
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div className="flex flex-col gap-1">
        <Label htmlFor={id}>{label}</Label>
        {description ? (
          <p id={`${id}-description`} className="text-sm text-muted-foreground">
            {description}
          </p>
        ) : null}
        {error ? (
          <p id={`${id}-error`} className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
      <Switch
        id={id}
        ref={ref}
        checked={value === true}
        onCheckedChange={onChange}
        onBlur={onBlur}
        disabled={disabled ?? field.disabled}
        aria-invalid={error !== undefined}
        aria-describedby={
          [description ? `${id}-description` : undefined, error ? `${id}-error` : undefined]
            .filter(Boolean)
            .join(' ') || undefined
        }
      />
    </div>
  );
}

/**
 * A bilingual pair (web §5, §6.3): the Arabic input first, then the English, each with its own
 * `lang` and `dir` and its own error, under one legend.
 */
export function BilingualField<
  Values extends FieldValues,
  Ar extends FieldPath<Values>,
  En extends FieldPath<Values>,
>({
  names,
  legend,
  description,
  className,
  disabled,
}: {
  names: { ar: Ar; en: En };
  legend: ReactNode;
  description?: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const t = useTranslations('common.locale');
  const message = useFieldMessage();
  const ar = useController<Values, Ar>({ name: names.ar });
  const en = useController<Values, En>({ name: names.en });
  const id = useId();
  const sides = [
    { locale: 'ar', control: ar },
    { locale: 'en', control: en },
  ] as const;
  return (
    <fieldset className={cn('flex flex-col gap-3', className)}>
      <legend className="mb-1 text-sm font-semibold text-foreground">{legend}</legend>
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      {sides.map(({ locale, control }) => {
        const error = message(control.fieldState.error?.message);
        const inputId = `${id}-${locale}`;
        return (
          <div key={locale} className="flex flex-col gap-1">
            <Label htmlFor={inputId} className="font-normal text-muted-foreground">
              {t(locale)}
            </Label>
            <Input
              id={inputId}
              ref={control.field.ref}
              name={control.field.name}
              value={control.field.value ?? ''}
              onChange={control.field.onChange}
              onBlur={control.field.onBlur}
              disabled={disabled ?? control.field.disabled}
              lang={locale}
              dir={dir(locale)}
              aria-invalid={error !== undefined}
              aria-describedby={error ? `${inputId}-error` : undefined}
            />
            {error ? (
              <p id={`${inputId}-error`} className="text-sm text-danger">
                {error}
              </p>
            ) : null}
          </div>
        );
      })}
    </fieldset>
  );
}

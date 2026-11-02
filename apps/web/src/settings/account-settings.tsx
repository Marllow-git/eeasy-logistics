'use client';

import { ApiError } from '@eeasy-logistics/contracts/http';
import { client, hooks, schemas, type AccountSettings } from '@eeasy-logistics/contracts/staff';
import { useCan } from '@eeasy-logistics/ui/authz';
import { Card, CardContent, CardHeader, CardTitle } from '@eeasy-logistics/ui/components/card';
import { ErrorState } from '@eeasy-logistics/ui/components/error-state';
import { Skeleton } from '@eeasy-logistics/ui/components/skeleton';
import {
  Form,
  SubmitButton,
  useContractForm,
  type FieldValues,
  type SubmitContext,
  type UseFormReturn,
} from '@eeasy-logistics/ui/form';
import {
  CheckboxGroupField,
  NumberField,
  RadioGroupField,
  SwitchField,
} from '@eeasy-logistics/ui/form/fields';
import { useTranslations } from '@eeasy-logistics/ui/intl';
import { useSessionFetcher } from '@eeasy-logistics/ui/session';
import {
  ReasonCodesEditor,
  reasonCodesSection,
  type ReasonCodesValues,
} from '@eeasy-logistics/ui/settings/reason-codes';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useId, type ReactNode } from 'react';

// The account settings forms (web §8; WEB-3 plan 2.6): one `Form` per section over the generated
// `UpdateAccountSettingsBody`, picked to the section's fields, so a failure in one section never
// blocks another; each save is a PATCH of that section's changed fields (PLAT-12 §8.2 #5) with the
// intent's Idempotency-Key, and the answer replaces the cached settings. A member without
// `core.account.manage` sees every value, disabled, and no save control (web §4).

const body = schemas.UpdateAccountSettingsBody;
const intakeSchema = body.pick({ intake_rule: true, max_attempts: true });
const proofSchema = body.pick({ proof_policy: true });
const dispatchSchema = body.pick({ auto_dispatch: true });
const securitySchema = body.pick({ second_factor_required: true });
const codSchema = body.pick({ allowed_cod_methods: true });
const driversSchema = body.pick({ offline_window_hours: true });
const warehouseSchema = body.pick({
  receipt_tolerance_pct: true,
  adjustment_approval_threshold: true,
});

const proofKinds = ['photo', 'signature', 'recipient_otp', 'id_check'] as const;
const codMethods = ['cash', 'card', 'mada', 'wallet'] as const;
/** Digital COD methods wait for the owner gate of ADR-0017 (PLAT-12 §8.2 #7). */
const ownerGated = new Set<string>(['card', 'mada', 'wallet']);

const settingsKey = hooks.getGetAccountSettingsQueryKey();

/** Sends one section's changed fields and puts the answer in the cache; resolves the new settings. */
function useSaveSettings() {
  const fetcher = useSessionFetcher();
  const queryClient = useQueryClient();
  return useCallback(
    async (changed: Partial<AccountSettings>, idempotencyKey: string) => {
      const answer = await client.updateAccountSettings(changed, {
        fetcher,
        headers: { 'Idempotency-Key': idempotencyKey },
      });
      queryClient.setQueryData(settingsKey, { data: answer.data, status: answer.status });
      return answer.data as AccountSettings;
    },
    [fetcher, queryClient],
  );
}

/** One section: a card with its title and line, the form, and its own save for managers. */
function Section<Values extends FieldValues, Output extends FieldValues>({
  title,
  description,
  form,
  manage,
  onSave,
  children,
}: {
  title: string;
  description?: string;
  form: UseFormReturn<Values, unknown, Output>;
  manage: boolean;
  onSave: (values: Output, context: SubmitContext<Output>) => Promise<unknown>;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <Card aria-labelledby={id}>
      <CardHeader>
        <CardTitle id={id}>{title}</CardTitle>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </CardHeader>
      <CardContent>
        <Form form={form} onSubmit={onSave} aria-labelledby={id}>
          {children}
          {manage ? <SubmitButton /> : null}
        </Form>
      </CardContent>
    </Card>
  );
}

function IntakeSection({ settings, manage }: { settings: AccountSettings; manage: boolean }) {
  const t = useTranslations('settings.account.intake');
  const save = useSaveSettings();
  const values = (from: AccountSettings) => ({
    intake_rule: from.intake_rule,
    max_attempts: from.max_attempts ?? 3,
  });
  const form = useContractForm(intakeSchema, values(settings), { disabled: !manage });
  return (
    <Section
      title={t('title')}
      form={form}
      manage={manage}
      onSave={async (_, { changed, idempotencyKey }) =>
        form.reset(values(await save(changed, idempotencyKey)))
      }
    >
      <RadioGroupField<typeof intakeSchema._input, 'intake_rule'>
        name="intake_rule"
        label={t('rule')}
        options={[
          {
            value: 'receive_as_pending',
            label: t('receive_as_pending'),
            description: t('receive_as_pending_hint'),
          },
          { value: 'auto_accept', label: t('auto_accept'), description: t('auto_accept_hint') },
        ]}
      />
      <NumberField<typeof intakeSchema._input, 'max_attempts'>
        name="max_attempts"
        label={t('max_attempts')}
        description={t('max_attempts_hint')}
        min={1}
        max={10}
      />
    </Section>
  );
}

function ProofSection({ settings, manage }: { settings: AccountSettings; manage: boolean }) {
  const t = useTranslations('settings.account.proof');
  const save = useSaveSettings();
  const values = (from: AccountSettings) => ({
    proof_policy: {
      delivery: from.proof_policy?.delivery ?? [],
      cod: from.proof_policy?.cod ?? [],
    },
  });
  const form = useContractForm(proofSchema, values(settings), { disabled: !manage });
  const options = proofKinds.map((kind) => ({ value: kind, label: t(`kinds.${kind}`) }));
  return (
    <Section
      title={t('title')}
      description={t('hint')}
      form={form}
      manage={manage}
      onSave={async (_, { changed, idempotencyKey }) =>
        form.reset(values(await save(changed, idempotencyKey)))
      }
    >
      <CheckboxGroupField<typeof proofSchema._input, 'proof_policy.delivery'>
        name="proof_policy.delivery"
        label={t('delivery')}
        options={options}
      />
      <CheckboxGroupField<typeof proofSchema._input, 'proof_policy.cod'>
        name="proof_policy.cod"
        label={t('cod')}
        options={options}
      />
    </Section>
  );
}

function ReasonCodesSection({ settings, manage }: { settings: AccountSettings; manage: boolean }) {
  const t = useTranslations('settings.account.reason_codes');
  const save = useSaveSettings();
  const values = (from: AccountSettings): ReasonCodesValues => ({
    reason_codes: (from.reason_codes ?? []).map((row) => ({ ...row, active: row.active ?? true })),
  });
  const form = useContractForm(reasonCodesSection, values(settings), { disabled: !manage });
  return (
    <Section
      title={t('title')}
      description={t('description')}
      form={form}
      manage={manage}
      onSave={async (_, { changed, idempotencyKey }) =>
        form.reset(values(await save(changed, idempotencyKey)))
      }
    >
      <ReasonCodesEditor disabled={!manage} />
    </Section>
  );
}

function DispatchSection({ settings, manage }: { settings: AccountSettings; manage: boolean }) {
  const t = useTranslations('settings.account.dispatch');
  const save = useSaveSettings();
  const values = (from: AccountSettings) => ({
    auto_dispatch: {
      enabled: from.auto_dispatch?.enabled ?? false,
      offer_ttl_s: from.auto_dispatch?.offer_ttl_s,
      drivers_per_wave: from.auto_dispatch?.drivers_per_wave,
    },
  });
  const form = useContractForm(dispatchSchema, values(settings), { disabled: !manage });
  return (
    <Section
      title={t('title')}
      form={form}
      manage={manage}
      onSave={async (_, { changed, idempotencyKey }) =>
        form.reset(values(await save(changed, idempotencyKey)))
      }
    >
      <SwitchField<typeof dispatchSchema._input, 'auto_dispatch.enabled'>
        name="auto_dispatch.enabled"
        label={t('enabled')}
        description={t('enabled_hint')}
      />
      <NumberField<typeof dispatchSchema._input, 'auto_dispatch.offer_ttl_s'>
        name="auto_dispatch.offer_ttl_s"
        label={t('offer_ttl')}
        description={t('offer_ttl_hint')}
        min={30}
      />
      <NumberField<typeof dispatchSchema._input, 'auto_dispatch.drivers_per_wave'>
        name="auto_dispatch.drivers_per_wave"
        label={t('drivers_per_wave')}
        description={t('drivers_per_wave_hint')}
        min={1}
      />
    </Section>
  );
}

function SecuritySection({ settings, manage }: { settings: AccountSettings; manage: boolean }) {
  const t = useTranslations('settings.account.security');
  const save = useSaveSettings();
  const values = (from: AccountSettings) => ({
    second_factor_required: from.second_factor_required ?? false,
  });
  const form = useContractForm(securitySchema, values(settings), { disabled: !manage });
  return (
    <Section
      title={t('title')}
      form={form}
      manage={manage}
      onSave={async (_, { changed, idempotencyKey }) =>
        form.reset(values(await save(changed, idempotencyKey)))
      }
    >
      <SwitchField<typeof securitySchema._input, 'second_factor_required'>
        name="second_factor_required"
        label={t('second_factor')}
        description={t('second_factor_hint')}
      />
    </Section>
  );
}

function CodSection({ settings, manage }: { settings: AccountSettings; manage: boolean }) {
  const t = useTranslations('settings.account.cod');
  const fields = useTranslations('errors.fields');
  const save = useSaveSettings();
  const values = (from: AccountSettings) => ({
    allowed_cod_methods: from.allowed_cod_methods ?? ['cash'],
  });
  const form = useContractForm(codSchema, values(settings), { disabled: !manage });
  return (
    <Section
      title={t('title')}
      form={form}
      manage={manage}
      onSave={async (_, { changed, idempotencyKey }) =>
        form.reset(values(await save(changed, idempotencyKey)))
      }
    >
      <CheckboxGroupField<typeof codSchema._input, 'allowed_cod_methods'>
        name="allowed_cod_methods"
        label={t('methods')}
        options={codMethods.map((method) => ({
          value: method,
          label: t(`kinds.${method}`),
          disabled: ownerGated.has(method),
          description: ownerGated.has(method) ? fields('owner_gate') : undefined,
        }))}
      />
    </Section>
  );
}

function DriversSection({ settings, manage }: { settings: AccountSettings; manage: boolean }) {
  const t = useTranslations('settings.account.drivers');
  const save = useSaveSettings();
  const values = (from: AccountSettings) => ({
    offline_window_hours: from.offline_window_hours ?? 12,
  });
  const form = useContractForm(driversSchema, values(settings), { disabled: !manage });
  return (
    <Section
      title={t('title')}
      form={form}
      manage={manage}
      onSave={async (_, { changed, idempotencyKey }) =>
        form.reset(values(await save(changed, idempotencyKey)))
      }
    >
      <NumberField<typeof driversSchema._input, 'offline_window_hours'>
        name="offline_window_hours"
        label={t('offline_window')}
        description={t('offline_window_hint')}
        min={1}
        max={48}
      />
    </Section>
  );
}

function WarehouseSection({ settings, manage }: { settings: AccountSettings; manage: boolean }) {
  const t = useTranslations('settings.account.warehouse');
  const save = useSaveSettings();
  const values = (from: AccountSettings) => ({
    receipt_tolerance_pct: from.receipt_tolerance_pct,
    adjustment_approval_threshold: from.adjustment_approval_threshold,
  });
  const form = useContractForm(warehouseSchema, values(settings), { disabled: !manage });
  return (
    <Section
      title={t('title')}
      form={form}
      manage={manage}
      onSave={async (_, { changed, idempotencyKey }) =>
        form.reset(values(await save(changed, idempotencyKey)))
      }
    >
      <NumberField<typeof warehouseSchema._input, 'receipt_tolerance_pct'>
        name="receipt_tolerance_pct"
        label={t('receipt_tolerance')}
        description={t('receipt_tolerance_hint')}
        min={0}
        step="any"
      />
      <NumberField<typeof warehouseSchema._input, 'adjustment_approval_threshold'>
        name="adjustment_approval_threshold"
        label={t('adjustment_threshold')}
        description={t('adjustment_threshold_hint')}
        min={0}
      />
    </Section>
  );
}

/** The account settings sections, from the cache the page hydrated (`getAccountSettings`). */
export function AccountSettingsForms() {
  const t = useTranslations('settings.account');
  const page = useTranslations('common.error_page');
  const fetcher = useSessionFetcher();
  const manage = useCan('core.account.manage');
  const query = hooks.useGetAccountSettings({ request: { fetcher } });
  const settings = query.data?.status === 200 ? query.data.data : undefined;

  if (settings === undefined) {
    return query.isError ? (
      <ErrorState
        labels={{
          title: page('title'),
          description: page('description'),
          reference: page('reference'),
          copy: page('copy'),
          copied: page('copied'),
          retry: page('retry'),
          home: page('home'),
        }}
        reference={query.error instanceof ApiError ? query.error.requestId : undefined}
        onRetry={() => void query.refetch()}
      />
    ) : (
      <Skeleton className="h-64 w-full" />
    );
  }
  const sections = { settings, manage };
  return (
    <div className="flex flex-col gap-6">
      {manage ? null : (
        <p role="note" className="rounded-md border border-border bg-muted px-4 py-3 text-sm">
          {t('read_only')}
        </p>
      )}
      <IntakeSection {...sections} />
      <ProofSection {...sections} />
      <ReasonCodesSection {...sections} />
      <DispatchSection {...sections} />
      <SecuritySection {...sections} />
      <CodSection {...sections} />
      <DriversSection {...sections} />
      <WarehouseSection {...sections} />
    </div>
  );
}

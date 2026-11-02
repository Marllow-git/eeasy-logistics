'use client';

import { schemas } from '@eeasy-logistics/contracts/staff';
import { formatNumber } from '@eeasy-logistics/i18n';
import { Plus, Trash2 } from 'lucide-react';
import { useId } from 'react';
import { useFieldArray, useFormContext } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '../components/button/button';
import { BilingualField, SwitchField, TextField } from '../form/fields';
import { useLocale, useTranslations } from '../intl';

// The reason-code list of the account settings (web §5 "reason-code labels"; WEB-3 plan 2.6, §7
// #3): code, Arabic and English label and active per row, added and removed in place, at most 100.
// The API checks the same rules (PLAT-12 §8.2 #7); the form checks them first so a bad code shows
// on its field before any call.

/** The code rule of PLAT-12 (`^[a-z0-9_]{2,40}$`). */
export const reasonCodePattern = /^[a-z0-9_]{2,40}$/;
export const maxReasonCodes = 100;
const maxLabelLength = 80;
/** No line break of any kind (CR, LF, NEL, U+2028, U+2029) in a label. */
const oneLine = /^[^\r\n\u0085\u2028\u2029]*$/;

const label = z
  .string()
  .min(1)
  .regex(oneLine)
  // Counted in code points, as the API counts (PLAT-12 §8.2 #7).
  .refine((value) => [...value].length <= maxLabelLength, { message: 'too_long' });

const generated = schemas.UpdateAccountSettingsBody.shape.reason_codes.unwrap().element;

/** The reason-code section's body: the generated one with the API's rules on top. */
export const reasonCodesSection = z.strictObject({
  reason_codes: z
    .array(
      generated.extend({
        code: z.string().regex(reasonCodePattern),
        label_ar: label,
        label_en: label,
      }),
    )
    .max(maxReasonCodes)
    .superRefine((rows, context) => {
      const seen = new Set<string>();
      rows.forEach((row, index) => {
        if (seen.has(row.code)) {
          context.addIssue({ code: 'custom', path: [index, 'code'], message: 'invalid' });
        }
        seen.add(row.code);
      });
    }),
});

export type ReasonCodesValues = z.input<typeof reasonCodesSection>;

/** The rows of `reason_codes` in the surrounding `Form`. */
export function ReasonCodesEditor({ disabled = false }: { disabled?: boolean }) {
  const t = useTranslations('settings.account.reason_codes');
  const locale = useLocale();
  const { control } = useFormContext<ReasonCodesValues>();
  const { fields, append, remove } = useFieldArray({ control, name: 'reason_codes' });
  const full = fields.length >= maxReasonCodes;
  const baseId = useId();
  return (
    <div className="flex flex-col gap-4">
      {fields.length === 0 ? <p className="text-sm text-muted-foreground">{t('empty')}</p> : null}
      <ol className="flex flex-col gap-4">
        {fields.map((field, index) => {
          const position = formatNumber(locale, index + 1);
          const heading = `${baseId}-${field.id}`;
          return (
            <li key={field.id} className="rounded-md border border-border p-4">
              <div role="group" aria-labelledby={heading} className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 id={heading} className="text-sm font-semibold text-foreground">
                    {t('row', { number: position })}
                  </h3>
                  {disabled ? null : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t('remove', { number: position })}
                      onClick={() => remove(index)}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  )}
                </div>
                <TextField<ReasonCodesValues, `reason_codes.${number}.code`>
                  name={`reason_codes.${index}.code`}
                  label={t('code')}
                  description={t('code_hint')}
                  input={{ dir: 'ltr', lang: 'en', autoComplete: 'off', spellCheck: false }}
                />
                <BilingualField<
                  ReasonCodesValues,
                  `reason_codes.${number}.label_ar`,
                  `reason_codes.${number}.label_en`
                >
                  names={{
                    ar: `reason_codes.${index}.label_ar`,
                    en: `reason_codes.${index}.label_en`,
                  }}
                  legend={t('label')}
                />
                <SwitchField<ReasonCodesValues, `reason_codes.${number}.active`>
                  name={`reason_codes.${index}.active`}
                  label={t('active')}
                />
              </div>
            </li>
          );
        })}
      </ol>
      {disabled ? null : (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            disabled={full}
            onClick={() => append({ code: '', label_ar: '', label_en: '', active: true })}
          >
            <Plus aria-hidden />
            {t('add')}
          </Button>
          {full ? <p className="text-sm text-muted-foreground">{t('limit')}</p> : null}
        </div>
      )}
    </div>
  );
}

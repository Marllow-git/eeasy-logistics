'use client';

import { schemas, type Site } from '@eeasy-logistics/contracts/staff';
import { formatNumber } from '@eeasy-logistics/i18n';
import { ExternalLink } from 'lucide-react';
import { useId } from 'react';
import { useController, useFormContext, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '../components/button/button';
import { Input } from '../components/input/input';
import { Label } from '../components/label/label';
import { Switch } from '../components/switch/switch';
import { FormField, useFieldMessage } from '../form/form';
import { NumberField } from '../form/fields';
import { useLocale, useTranslations } from '../intl';
import { oneLine } from './reason-codes';

// The site form (web §8 "Sites"; WEB-3 plan 2.8; PLAT-12 plan 2.5 and §8.2 #15): the generated
// `CreateSiteBody` kind with the API's rules the contract cannot say (names 1 to 120 code points on
// one line, the address up to 500, the short code `^[A-Z]{4}[0-9]{4}$` upper-cased, the point as a
// latitude and longitude pair, `HH:MM` opening times), on form values a person edits (seven
// weekday rows with an open switch, the point as two numbers), and a transform to the body
// `createSite` and `updateSite` take whole: an optional field left empty is left out, which the
// API reads as cleared. Design references: Square's business hours (one row per weekday, the times
// disabled on a closed day); no reference shows the short code or the bilingual pair.

const maxName = 120;
const maxAddress = 500;
const shortCodePattern = /^[A-Z]{4}[0-9]{4}$/;
const clockPattern = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;
/** Sunday to Saturday, as the contract numbers them (0 to 6). */
export const weekdays = [0, 1, 2, 3, 4, 5, 6] as const;

const codePoints = (value: string) => [...value].length;
const siteName = z
  .string()
  .min(1)
  .regex(oneLine)
  .refine((value) => codePoints(value) <= maxName, { message: 'too_long' });
const coordinate = z.union([z.number(), z.nan()]);

const hoursRow = z
  .object({ weekday: z.number(), open: z.boolean(), opens: z.string(), closes: z.string() })
  .superRefine((row, context) => {
    if (!row.open) return;
    for (const key of ['opens', 'closes'] as const) {
      if (clockPattern.test(row[key])) continue;
      context.addIssue({
        code: 'custom',
        path: [key],
        message: row[key] === '' ? 'required' : 'invalid',
      });
    }
  });

const formShape = z.object({
  kind: schemas.CreateSiteBody.shape.kind,
  name_ar: siteName,
  name_en: siteName,
  address_text: z
    .string()
    .refine((value) => codePoints(value) <= maxAddress, { message: 'too_long' }),
  national_address_short_code: z
    .string()
    .transform((value) => value.trim().toUpperCase())
    .refine((value) => value === '' || shortCodePattern.test(value), { message: 'invalid' }),
  lat: coordinate,
  lng: coordinate,
  hours: z.array(hoursRow).length(weekdays.length),
});

/** What the form holds. */
export type SiteFormValues = z.input<typeof formShape>;

/** The body of `createSite` and `updateSite` (the whole editable site). */
export type SiteBody = Pick<
  Site,
  | 'kind'
  | 'name_ar'
  | 'name_en'
  | 'address_text'
  | 'national_address_short_code'
  | 'point'
  | 'opening_hours'
>;

/** The form's schema: the field rules, the point pair, and the transform to the body. */
export const siteFormSchema = formShape
  .superRefine((values, context) => {
    const ranges = { lat: 90, lng: 180 } as const;
    for (const key of ['lat', 'lng'] as const) {
      const value = values[key];
      const other = values[key === 'lat' ? 'lng' : 'lat'];
      if (Number.isNaN(value)) {
        if (!Number.isNaN(other))
          context.addIssue({ code: 'custom', path: [key], message: 'required' });
      } else if (Math.abs(value) > ranges[key]) {
        context.addIssue({ code: 'custom', path: [key], message: 'invalid' });
      }
    }
  })
  .transform((values): SiteBody => ({
    kind: values.kind,
    name_ar: values.name_ar,
    name_en: values.name_en,
    ...(values.address_text.trim() === '' ? {} : { address_text: values.address_text }),
    ...(values.national_address_short_code === ''
      ? {}
      : { national_address_short_code: values.national_address_short_code }),
    ...(Number.isNaN(values.lat) || Number.isNaN(values.lng)
      ? {}
      : { point: { lat: values.lat, lng: values.lng } }),
    opening_hours: values.hours
      .filter((row) => row.open)
      .map(({ weekday, opens, closes }) => ({ weekday, opens, closes })),
  }));

/**
 * The form values of `site`, or of a new branch. One window per weekday: a second window of a
 * day (possible through the API only) is not shown and is dropped by the next save.
 */
export function siteFormValues(site?: Partial<SiteBody>): SiteFormValues {
  return {
    kind: site?.kind ?? 'branch',
    name_ar: site?.name_ar ?? '',
    name_en: site?.name_en ?? '',
    address_text: site?.address_text ?? '',
    national_address_short_code: site?.national_address_short_code ?? '',
    lat: site?.point?.lat ?? Number.NaN,
    lng: site?.point?.lng ?? Number.NaN,
    hours: weekdays.map((weekday) => {
      const row = site?.opening_hours?.find((candidate) => candidate.weekday === weekday);
      return {
        weekday,
        open: row !== undefined,
        opens: row?.opens ?? '',
        closes: row?.closes ?? '',
      };
    }),
  };
}

/** The short code: left to right, upper-cased when the field is left. */
export function ShortCodeField({ disabled }: { disabled?: boolean }) {
  const t = useTranslations('settings.sites.form');
  return (
    <FormField<SiteFormValues, 'national_address_short_code'>
      name="national_address_short_code"
      label={t('short_code')}
      description={t('short_code_hint')}
    >
      {({ value, onChange, onBlur, ...control }) => (
        <Input
          {...control}
          disabled={disabled ?? control.disabled}
          dir="ltr"
          lang="en"
          maxLength={8}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          className="max-w-40 text-start font-mono"
          value={value ?? ''}
          onChange={onChange}
          onBlur={() => {
            const upper = (value ?? '').toUpperCase();
            if (upper !== value) onChange(upper);
            onBlur();
          }}
        />
      )}
    </FormField>
  );
}

/** The point as latitude and longitude, with an "open in maps" link once both are numbers. */
export function PointFields({ disabled }: { disabled?: boolean }) {
  const t = useTranslations('settings.sites.form');
  const locale = useLocale();
  const [lat, lng] = useWatch<SiteFormValues, ['lat', 'lng']>({ name: ['lat', 'lng'] });
  const valid =
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    !Number.isNaN(lat) &&
    !Number.isNaN(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180;
  const fixed = (value: number) => formatNumber(locale, value, { maximumFractionDigits: 5 });
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-sm font-semibold text-foreground">{t('location_title')}</legend>
      <p className="text-sm text-muted-foreground">{t('location_hint')}</p>
      <div className="flex flex-wrap gap-4">
        <NumberField<SiteFormValues, 'lat'>
          name="lat"
          label={t('lat')}
          step="any"
          min={-90}
          max={90}
          decimal
          disabled={disabled}
        />
        <NumberField<SiteFormValues, 'lng'>
          name="lng"
          label={t('lng')}
          step="any"
          min={-180}
          max={180}
          decimal
          disabled={disabled}
        />
      </div>
      {valid ? (
        <a
          href={`https://www.google.com/maps?q=${lat},${lng}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 self-start text-sm font-semibold text-primary hover:underline"
        >
          <ExternalLink aria-hidden className="size-4" />
          {t('open_in_maps')}
          <span dir="ltr" className="font-normal text-muted-foreground">
            ({fixed(lat)}, {fixed(lng)})
          </span>
        </a>
      ) : null}
    </fieldset>
  );
}

/** One `HH:MM` time of a weekday row. */
function TimeInput({
  name,
  label,
  disabled,
}: {
  name: `hours.${number}.opens` | `hours.${number}.closes`;
  label: string;
  disabled: boolean;
}) {
  const { field, fieldState } = useController<SiteFormValues, typeof name>({ name });
  const { ref, value, onChange, onBlur } = field;
  const message = useFieldMessage()(fieldState.error?.message);
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="sr-only">
        {label}
      </Label>
      <Input
        id={id}
        ref={ref}
        dir="ltr"
        lang="en"
        inputMode="numeric"
        placeholder="09:00"
        maxLength={5}
        disabled={disabled}
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        aria-invalid={message !== undefined}
        aria-describedby={message ? `${id}-error` : undefined}
        className="w-24 text-start font-mono"
      />
      {message ? (
        <p id={`${id}-error`} className="text-xs text-danger">
          {message}
        </p>
      ) : null}
    </div>
  );
}

/** One weekday: its name, whether it opens, and the two times (disabled on a closed day). */
function HoursRow({ index, disabled }: { index: number; disabled: boolean }) {
  const t = useTranslations('settings.sites');
  const { field } = useController<SiteFormValues, `hours.${number}.open`>({
    name: `hours.${index}.open`,
  });
  const { ref, value: open, onChange, onBlur } = field;
  const day = t(`weekdays.${String(weekdays[index]) as '0'}`);
  return (
    <div role="group" aria-label={day} className="flex flex-wrap items-start gap-3 py-2">
      <span className="w-24 pt-2 text-sm font-semibold text-foreground">{day}</span>
      <div className="flex items-center gap-2 pt-2">
        <Switch
          ref={ref}
          checked={open}
          onCheckedChange={onChange}
          onBlur={onBlur}
          disabled={disabled}
          aria-label={t('form.open_on', { day })}
        />
        {open ? null : <span className="text-sm text-muted-foreground">{t('form.closed')}</span>}
      </div>
      {open ? (
        <div className="flex items-start gap-2">
          <TimeInput
            name={`hours.${index}.opens`}
            label={`${t('form.opens')}, ${day}`}
            disabled={disabled}
          />
          <span aria-hidden className="pt-2 text-muted-foreground">
            –
          </span>
          <TimeInput
            name={`hours.${index}.closes`}
            label={`${t('form.closes')}, ${day}`}
            disabled={disabled}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * The opening hours: one row per weekday, Sunday first, and "Same every day", which copies the
 * first open day's times to every day and opens them all.
 */
export function OpeningHoursEditor({ disabled = false }: { disabled?: boolean }) {
  const t = useTranslations('settings.sites.form');
  const { getValues, setValue } = useFormContext<SiteFormValues>();
  const sameEveryDay = () => {
    const first = getValues('hours').find((row) => row.open);
    const opens = first?.opens ?? '09:00';
    const closes = first?.closes ?? '17:00';
    weekdays.forEach((_, index) => {
      setValue(`hours.${index}.open`, true, { shouldDirty: true });
      setValue(`hours.${index}.opens`, opens, { shouldDirty: true });
      setValue(`hours.${index}.closes`, closes, { shouldDirty: true });
    });
  };
  return (
    <fieldset className="flex flex-col">
      <legend className="mb-1 text-sm font-semibold text-foreground">{t('hours_title')}</legend>
      <p className="text-sm text-muted-foreground">{t('hours_hint')}</p>
      <div className="flex flex-col divide-y divide-border">
        {weekdays.map((weekday, index) => (
          <HoursRow key={weekday} index={index} disabled={disabled} />
        ))}
      </div>
      {disabled ? null : (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="mt-2 self-start"
          onClick={sameEveryDay}
        >
          {t('same_every_day')}
        </Button>
      )}
    </fieldset>
  );
}

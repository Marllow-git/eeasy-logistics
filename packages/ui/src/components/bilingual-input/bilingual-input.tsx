'use client';

import { dir } from '@eeasy-logistics/i18n';
import { type ComponentProps, type ReactNode, useId } from 'react';
import { cn } from '../../cn';
import { useTranslations } from '../../intl';
import { Input } from '../input/input';
import { Label } from '../label/label';

type FieldProps = Omit<ComponentProps<'input'>, 'name' | 'dir' | 'lang' | 'id'>;

/**
 * The `name_ar` and `name_en` inputs of a bilingual field (web §5, §6.3): Arabic first, each input
 * with its own `lang` and `dir`, both labelled by the language name under one legend.
 */
export function BilingualInput({
  name,
  legend,
  ar,
  en,
  className,
}: {
  /** Field base name; the inputs are `<name>_ar` and `<name>_en`. */
  name: string;
  legend: ReactNode;
  ar?: FieldProps;
  en?: FieldProps;
  className?: string;
}) {
  const t = useTranslations('common.locale');
  const id = useId();
  const fields = [
    { locale: 'ar', props: ar },
    { locale: 'en', props: en },
  ] as const;
  return (
    <fieldset className={cn('flex flex-col gap-3', className)}>
      <legend className="mb-1 text-sm font-semibold text-foreground">{legend}</legend>
      {fields.map(({ locale, props }) => (
        <div key={locale} className="flex flex-col gap-1">
          <Label htmlFor={`${id}-${locale}`} className="font-normal text-muted-foreground">
            {t(locale)}
          </Label>
          <Input
            {...props}
            id={`${id}-${locale}`}
            name={`${name}_${locale}`}
            lang={locale}
            dir={dir(locale)}
          />
        </div>
      ))}
    </fieldset>
  );
}

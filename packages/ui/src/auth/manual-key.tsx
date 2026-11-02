'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../components/button/button';
import { cn } from '../cn';
import { useTranslations } from '../intl';

/**
 * The base32 secret of an `otpauth://totp/…` Key URI (`secret=`, RFC 4648 §6 alphabet, upper case,
 * no padding), or undefined when the URI is not one. The value is a TOTP secret: it stays in the
 * page's memory, never in a URL, a log line or an analytics event.
 */
export function secretFromOtpauth(uri: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'otpauth:') return undefined;
  const secret = parsed.searchParams.get('secret')?.replace(/=+$/, '').toUpperCase();
  return secret !== undefined && /^[A-Z2-7]+$/.test(secret) ? secret : undefined;
}

/** A key as groups of four characters, the way people read it into an app. */
export function keyGroups(secret: string): string[] {
  return secret.match(/.{1,4}/g) ?? [];
}

/**
 * The manual-entry key of an authenticator enrolment (WEB-2 plan 2.9; the Mercury and Vimeo
 * references of docs/references/design/WEB-2.md): the base32 secret in groups of four, left to
 * right in both locales (a key is LTR text inside an RTL page, web §5), with a copy control that
 * copies the key without the spaces and announces it.
 */
export function ManualKey({ secret, className }: { secret: string; className?: string }) {
  const t = useTranslations('auth.totp');
  const [copied, setCopied] = useState(false);

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <p className="text-sm text-muted-foreground">{t('manual')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <code
          dir="ltr"
          translate="no"
          data-testid="totp-manual-key"
          className="rounded-md border border-border bg-muted px-3 py-2 font-mono text-sm tracking-wider text-foreground"
        >
          {keyGroups(secret).join(' ')}
        </code>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(secret)
              .then(() => setCopied(true))
              .catch(() => setCopied(false));
          }}
        >
          {copied ? (
            <Check aria-hidden className="size-4" />
          ) : (
            <Copy aria-hidden className="size-4" />
          )}
          {t('copy')}
        </Button>
      </div>
      <p role="status" className="min-h-5 text-sm text-muted-foreground">
        {copied ? t('copied') : null}
      </p>
    </div>
  );
}

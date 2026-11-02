import type { ReactNode } from 'react';
import { cn } from '../../cn';

// A full-width notice that stays on the page (WEB-4 plan 2.4, 2.5; design references: Etsy's
// pending-closure banner with one action, Zendesk's "suspended" notice on the detail page): the
// console's "Acting on account" banner in the `support` colour (web §3.5, a token no merchant
// screen uses), and a state notice in `danger` or `warning`. Not dismissable: the state it names
// is still true. Its actions sit at the end edge in either direction.

const tones = {
  support: 'bg-support text-support-foreground',
  danger: 'bg-danger text-danger-foreground',
  warning: 'bg-warning text-warning-foreground',
} as const;

export function Banner({
  tone,
  label,
  title,
  children,
  actions,
  className,
}: {
  tone: keyof typeof tones;
  /** The landmark's accessible name ("Acting on account"). */
  label: string;
  title: ReactNode;
  /** The details under the title. */
  children?: ReactNode;
  /** One or two controls at the end (the "Exit account" button). */
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={label}
      data-tone={tone}
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md px-4 py-3 text-sm',
        tones[tone],
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="font-semibold">{title}</p>
        {children ? <div className="min-w-0 break-words">{children}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </section>
  );
}

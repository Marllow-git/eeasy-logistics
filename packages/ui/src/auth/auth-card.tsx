import type { ReactNode } from 'react';
import { cn } from '../cn';

/**
 * The centred card of every sign-in door (WEB-2 plan 2.10; the Hume, HoneyBook and Retool
 * references of docs/references/design/WEB-2.md): one heading, a line of why, the form, and a foot
 * for the way back. The (auth) frame around it already carries the brand and the locale switch in
 * its top bar, so the card holds neither.
 */
export function AuthCard({
  title,
  description,
  children,
  footer,
  className,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'mx-auto my-6 flex w-full max-w-md flex-col gap-6 rounded-lg border border-border bg-background p-6 shadow-sm sm:my-12 sm:p-8',
        className,
      )}
    >
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
        {description === undefined ? null : (
          <div className="text-sm text-muted-foreground">{description}</div>
        )}
      </header>
      {children}
      {footer === undefined ? null : (
        <footer className="flex flex-col gap-2 border-t border-border pt-4 text-sm">
          {footer}
        </footer>
      )}
    </section>
  );
}

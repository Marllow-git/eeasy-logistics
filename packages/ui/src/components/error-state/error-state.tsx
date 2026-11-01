'use client';

import { CircleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '../../cn';
import { Button } from '../button/button';

/** The strings an `ErrorState` shows, translated by the caller (a global error has no provider). */
export interface ErrorStateLabels {
  title: string;
  description: string;
  /** Label of the reference number, e.g. "Reference". */
  reference: string;
  copy: string;
  copied: string;
  retry: string;
  home: string;
}

/**
 * The error page of a route segment or of the whole app (web §10.4; design references
 * docs/references/design/PLAT-14.md): one heading, one line of help, the reference support asks
 * for as copyable text, a retry action and a way home. `variant="section"` fills the content area
 * of the shell, whose navigation stays usable; `variant="page"` fills the viewport for
 * `global-error.tsx`. The reference (a request id or an error report id) is left to right inside
 * Arabic text and uses Western digits.
 */
export function ErrorState({
  labels,
  reference,
  onRetry,
  homeHref,
  variant = 'section',
  className,
}: {
  labels: ErrorStateLabels;
  reference?: string | undefined;
  onRetry?: (() => void) | undefined;
  /** Omitted where there is no home to go to (recipient pages). */
  homeHref?: string | undefined;
  variant?: 'section' | 'page';
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = () => {
    if (reference === undefined) return;
    void navigator.clipboard?.writeText(reference).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };

  return (
    <section
      aria-labelledby="error-state-title"
      className={cn(
        'mx-auto flex w-full max-w-lg flex-col items-center gap-4 px-4 text-center',
        variant === 'page' ? 'min-h-dvh justify-center py-12' : 'py-16',
        className,
      )}
    >
      <CircleAlert aria-hidden className="size-10 text-danger" />
      <h1 id="error-state-title" className="text-2xl font-semibold text-foreground">
        {labels.title}
      </h1>
      <p className="text-sm text-muted-foreground">{labels.description}</p>
      {reference !== undefined ? (
        <div className="flex flex-wrap items-center justify-center gap-2 rounded-md bg-muted px-3 py-2 text-sm">
          <span className="text-muted-foreground">{labels.reference}</span>
          <code dir="ltr" data-testid="error-reference" className="font-mono select-all">
            {reference}
          </code>
          <Button type="button" variant="ghost" size="sm" onClick={copy}>
            {copied ? labels.copied : labels.copy}
          </Button>
          <span role="status" className="sr-only">
            {copied ? labels.copied : null}
          </span>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-center gap-2">
        {onRetry ? (
          <Button type="button" onClick={onRetry}>
            {labels.retry}
          </Button>
        ) : null}
        {homeHref !== undefined ? (
          <Button asChild variant="secondary">
            <a href={homeHref}>{labels.home}</a>
          </Button>
        ) : null}
      </div>
    </section>
  );
}

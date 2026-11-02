import { useId } from 'react';
import { cn } from '../../cn';

// Machine text shown as it is (WEB-4 plan 2.8; design references: Gumloop's outputs as a code
// block, Snowflake's full statement with the error under it, nothing hidden behind "Show more"):
// an outbox envelope, a payload, an error. Always left to right inside either page direction, in
// the mono face, wrapped so a long line never widens the page; a JSON value is printed indented.

export function codeText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return '';
  return JSON.stringify(value, null, 2);
}

export function CodeBlock({
  label,
  value,
  className,
}: {
  /** The block's heading and accessible name ("Payload"). */
  label: string;
  /** A string as it is, anything else as indented JSON. */
  value: unknown;
  className?: string;
}) {
  const id = useId();
  return (
    <figure className={cn('flex min-w-0 flex-col gap-1', className)}>
      <figcaption id={id} className="text-sm font-semibold text-foreground">
        {label}
      </figcaption>
      <pre
        dir="ltr"
        aria-labelledby={id}
        tabIndex={0}
        className="max-h-96 overflow-auto rounded-md border border-border bg-muted p-3 text-start font-mono text-xs leading-relaxed whitespace-pre-wrap break-all text-foreground"
      >
        <code>{codeText(value)}</code>
      </pre>
    </figure>
  );
}

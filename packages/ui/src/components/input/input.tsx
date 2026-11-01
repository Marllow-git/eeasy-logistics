import type { ComponentProps } from 'react';
import { cn } from '../../cn';

/**
 * A text input. Phone, email and code fields pass `dir="ltr"` in both locales (web §5); free text
 * keeps the document direction.
 */
export function Input({ className, type = 'text', ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      className={cn(
        'h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger',
        className,
      )}
      {...props}
    />
  );
}

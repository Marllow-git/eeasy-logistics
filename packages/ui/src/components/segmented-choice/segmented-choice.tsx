'use client';

import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '../../cn';

// One of a few exclusive values side by side (WEB-4 plan 2.6: a rollout mode off, allowlist,
// all): Radix radio semantics, so arrow keys move in the reading direction and one value is
// selected; laid out as joined segments that follow `dir`. The selected segment is filled with
// the primary colour. A change is a request: the caller decides (a reason dialog) and sets
// `value` once the write succeeds.

export interface SegmentOption {
  readonly value: string;
  readonly label: ReactNode;
}

export function SegmentedChoice({
  label,
  options,
  value,
  onValueChange,
  disabled,
  describedBy,
  className,
}: {
  /** The group's accessible name (the feature it sets). */
  label: string;
  options: readonly SegmentOption[];
  value: string | undefined;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  /** The id of the line that explains the selected value or why the control is disabled. */
  describedBy?: string;
  className?: string;
}) {
  return (
    <RadioGroupPrimitive.Root
      aria-label={label}
      aria-describedby={describedBy}
      value={value ?? ''}
      onValueChange={onValueChange}
      disabled={disabled}
      orientation="horizontal"
      className={cn(
        'inline-flex rounded-md border border-input bg-background p-0.5 data-[disabled]:opacity-60',
        className,
      )}
    >
      {options.map((option) => (
        <RadioGroupPrimitive.Item
          key={option.value}
          value={option.value}
          className="rounded-sm px-3 py-1.5 text-sm text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:cursor-not-allowed disabled:hover:bg-transparent data-[state=checked]:bg-primary data-[state=checked]:font-semibold data-[state=checked]:text-primary-foreground"
        >
          {option.label}
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  );
}

'use client';

import { Search } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Input } from '../components/input/input';
import { Label } from '../components/label/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/select/select';
import { cn } from '../cn';

// The filters of a list's toolbar (web §2.4, §6.3; WEB-3 plan 2.4, 2.7 to 2.9): each shows one URL
// parameter and reports a change; the page writes it to the URL (`useListParams`), so the list's
// query key follows. "All" is the absent parameter. Design references: the status tabs of
// Searchable and the filter row of Klaviyo (docs/references/design/WEB-3.md).

export interface FilterOption {
  readonly value: string;
  readonly label: string;
}

/** One value of a short list as a row of toggle chips, "All" first. */
export function ChipFilter({
  label,
  allLabel,
  options,
  value,
  onChange,
}: {
  label: string;
  allLabel: string;
  options: readonly FilterOption[];
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}) {
  const chips = [{ value: undefined, label: allLabel }, ...options];
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1">
      {chips.map((chip) => {
        const pressed = chip.value === value;
        return (
          <button
            key={chip.value ?? ''}
            type="button"
            aria-pressed={pressed}
            onClick={() => onChange(chip.value)}
            className={cn(
              'h-8 rounded-full border px-3 text-sm font-semibold transition-colors',
              pressed
                ? 'border-transparent bg-primary text-primary-foreground'
                : 'border-border bg-background text-foreground hover:bg-muted',
            )}
          >
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}

const allValue = '__all';

/** One value of a longer list as a select, with an "All" entry first. */
export function SelectFilter({
  label,
  allLabel,
  options,
  value,
  onChange,
  className,
}: {
  label: string;
  allLabel: string;
  options: readonly FilterOption[];
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Select
        value={value ?? allValue}
        onValueChange={(next) => onChange(next === allValue ? undefined : next)}
      >
        <SelectTrigger id={id} className="h-9 min-w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={allValue}>{allLabel}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * A calendar day (`YYYY-MM-DD`, Gregorian) from the browser's date picker; an empty input is no
 * filter. Left to right with Western digits whatever the page's language (web §5).
 */
export function DateFilter({
  label,
  value,
  onChange,
  min,
  className,
}: {
  label: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  min?: string;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        type="date"
        dir="ltr"
        lang="en"
        min={min}
        value={value ?? ''}
        className="h-9 w-40 text-start"
        onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.value)}
      />
    </div>
  );
}

/**
 * A text filter that reports its value after the typing pauses (`delay` ms), trimmed, and at once
 * on Enter; `valid` keeps a value the API would refuse (a malformed id) from leaving the input.
 */
export function SearchFilter({
  label,
  value,
  onChange,
  delay = 300,
  valid,
  invalidMessage,
  dir,
  className,
}: {
  label: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  delay?: number;
  valid?: (value: string) => boolean;
  invalidMessage?: string;
  dir?: 'ltr' | 'auto';
  className?: string;
}) {
  const id = useId();
  const [text, setText] = useState(value ?? '');
  const reported = useRef(value ?? '');
  const trimmed = text.trim();
  const invalid = trimmed !== '' && valid !== undefined && !valid(trimmed);

  useEffect(() => {
    if (invalid || trimmed === reported.current) return undefined;
    const timer = window.setTimeout(() => {
      reported.current = trimmed;
      onChange(trimmed === '' ? undefined : trimmed);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [trimmed, invalid, delay, onChange]);

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          id={id}
          type="search"
          dir={dir ?? 'auto'}
          value={text}
          aria-invalid={invalid}
          aria-describedby={invalid ? `${id}-error` : undefined}
          className="h-9 min-w-48 ps-8"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || invalid) return;
            reported.current = trimmed;
            onChange(trimmed === '' ? undefined : trimmed);
          }}
        />
      </div>
      {invalid && invalidMessage ? (
        <p id={`${id}-error`} className="text-xs text-danger">
          {invalidMessage}
        </p>
      ) : null}
    </div>
  );
}

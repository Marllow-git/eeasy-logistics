// Green fixture for eeasy/no-physical-direction-utilities: the logical equivalents of
// physical.tsx, plus strings outside a class context that merely look physical.
declare function cn(...inputs: unknown[]): string;
declare function cva(base: string, config: unknown): unknown;
declare const active: boolean;

export const button = cva('inline-flex ms-2', {
  variants: { side: { start: 'ps-4', end: 'pe-4' } },
});

export const label = 'ml-4 is only text here';

export function Example() {
  return (
    <div className="me-4 text-start" title="text-left">
      <span className={cn('rounded-s-md', active && 'border-e-2', `md:start-0`)} />
      <span className="rtl:-ms-1 float-end end-3 inset-x-0 rtl:-scale-x-100" />
    </div>
  );
}

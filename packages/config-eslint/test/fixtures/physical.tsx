// Red fixture for eeasy/no-physical-direction-utilities: every class string below is physical.
// test/no-physical-direction-utilities.test.js expects exactly these reports, in this order.
declare function cn(...inputs: unknown[]): string;
declare function cva(base: string, config: unknown): unknown;
declare const active: boolean;

export const button = cva('inline-flex ml-2', {
  variants: { side: { start: 'pl-4', end: 'pr-4' } },
});

export function Example() {
  return (
    <div className="mr-4 text-left">
      <span className={cn('rounded-l-md', active && 'border-r-2', `md:left-0`)} />
      <span className="rtl:-ml-1 float-right right-3" />
      <span className={cn({ 'ml-4': active })} />
    </div>
  );
}

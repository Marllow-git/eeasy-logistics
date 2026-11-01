import { cn } from '../../cn';

/** An order number in a left-to-right isolate, so `ORD-2026-0042` never reorders in Arabic (web §5). */
export function OrderNumber({ value, className }: { value: string; className?: string }) {
  return (
    <bdi dir="ltr" className={cn('tabular-nums', className)}>
      {value}
    </bdi>
  );
}

'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Direction, Toast as ToastPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '../../cn';

/**
 * Radix's swipe direction is physical, so the provider derives it from the reading direction:
 * a toast leaves towards the end edge it sits on (left in Arabic, right in English).
 */
export function ToastProvider(
  props: Omit<ComponentProps<typeof ToastPrimitive.Provider>, 'swipeDirection'>,
) {
  const direction = Direction.useDirection();
  return (
    <ToastPrimitive.Provider swipeDirection={direction === 'rtl' ? 'left' : 'right'} {...props} />
  );
}

export function ToastViewport({
  className,
  ...props
}: ComponentProps<typeof ToastPrimitive.Viewport>) {
  return (
    <ToastPrimitive.Viewport
      className={cn(
        'fixed end-0 bottom-0 z-50 m-0 flex max-h-dvh w-full list-none flex-col gap-2 p-4 outline-none sm:max-w-sm',
        className,
      )}
      {...props}
    />
  );
}

const toastVariants = cva(
  'relative flex w-full items-start gap-3 rounded-md border bg-background p-4 pe-10 text-foreground shadow-lg',
  {
    variants: {
      tone: {
        neutral: 'border-border',
        success: 'border-success',
        danger: 'border-danger',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export function Toast({
  className,
  tone,
  children,
  ...props
}: ComponentProps<typeof ToastPrimitive.Root> & VariantProps<typeof toastVariants>) {
  const t = useTranslations('common.actions');
  return (
    <ToastPrimitive.Root className={cn(toastVariants({ tone }), className)} {...props}>
      <div className="grid gap-1">{children}</div>
      <ToastPrimitive.Close
        className="absolute end-2 top-2 rounded-sm p-1 text-muted-foreground hover:bg-muted"
        aria-label={t('close')}
      >
        <X aria-hidden className="size-4" />
      </ToastPrimitive.Close>
    </ToastPrimitive.Root>
  );
}

export function ToastTitle({ className, ...props }: ComponentProps<typeof ToastPrimitive.Title>) {
  return <ToastPrimitive.Title className={cn('text-sm font-semibold', className)} {...props} />;
}

export function ToastDescription({
  className,
  ...props
}: ComponentProps<typeof ToastPrimitive.Description>) {
  return (
    <ToastPrimitive.Description
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

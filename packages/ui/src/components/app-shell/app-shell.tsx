'use client';

import { Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Dialog as DialogPrimitive } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '../../cn';
import { useTranslations } from '../../intl';

export type NavigationItem = {
  href: string;
  label: string;
  icon?: ReactNode;
  /** Defaults to the current path being exactly `href`. */
  active?: boolean;
};

function Navigation({ items, label }: { items: NavigationItem[]; label: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="flex flex-col gap-1 p-2">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={(item.active ?? pathname === item.href) ? 'page' : undefined}
          className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground hover:bg-muted aria-[current=page]:bg-muted aria-[current=page]:font-semibold [&_svg]:size-4"
        >
          {item.icon}
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * The application frame (web §6, ADR-0033): navigation on the start side (right in Arabic, left in
 * English, by flex order and logical borders only), a top bar with the locale switch and the user
 * slot at the end, and the page in `<main>`. Below `md` the navigation opens as a sheet from the
 * start edge. A skip link leads to the content. With no navigation (sign-in and recipient pages)
 * the frame is the top bar alone.
 */
export function AppShell({
  brand,
  navigation,
  topBar,
  children,
}: {
  brand: ReactNode;
  navigation: NavigationItem[];
  /** End of the top bar: the locale switch and, from WEB-2, the user menu. */
  topBar?: ReactNode;
  children: ReactNode;
}) {
  const t = useTranslations('common.shell');
  const tNav = useTranslations('nav');
  const hasNavigation = navigation.length > 0;
  return (
    <div className="flex min-h-dvh bg-background text-foreground">
      <a
        href="#main"
        className="sr-only rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-50"
      >
        {t('skip_to_content')}
      </a>
      {hasNavigation ? (
        <aside className="hidden w-60 shrink-0 flex-col border-e border-border bg-surface md:flex">
          <div className="flex h-14 items-center px-5 font-semibold">{brand}</div>
          <Navigation items={navigation} label={tNav('primary')} />
        </aside>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-2 border-b border-border px-4">
          {hasNavigation ? (
            <DialogPrimitive.Root>
              <DialogPrimitive.Trigger
                className="rounded-md p-2 text-foreground hover:bg-muted md:hidden"
                aria-label={t('open_navigation')}
              >
                <Menu aria-hidden className="size-5" />
              </DialogPrimitive.Trigger>
              <DialogPrimitive.Portal>
                <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-foreground/40 md:hidden" />
                <DialogPrimitive.Content className="fixed inset-y-0 start-0 z-50 flex w-72 max-w-[85vw] flex-col bg-surface shadow-lg md:hidden">
                  <div className="flex h-14 items-center justify-between px-5">
                    <DialogPrimitive.Title className="font-semibold">{brand}</DialogPrimitive.Title>
                    <DialogPrimitive.Close
                      className="rounded-md p-2 hover:bg-muted"
                      aria-label={t('close_navigation')}
                    >
                      <X aria-hidden className="size-5" />
                    </DialogPrimitive.Close>
                  </div>
                  <DialogPrimitive.Description className="sr-only">
                    {tNav('primary')}
                  </DialogPrimitive.Description>
                  <Navigation items={navigation} label={tNav('primary')} />
                </DialogPrimitive.Content>
              </DialogPrimitive.Portal>
            </DialogPrimitive.Root>
          ) : null}
          <div className={cn('font-semibold', hasNavigation && 'md:hidden')}>{brand}</div>
          <div className="ms-auto flex items-center gap-2">{topBar}</div>
        </header>
        <main id="main" tabIndex={-1} className="flex-1 p-4 outline-none md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}

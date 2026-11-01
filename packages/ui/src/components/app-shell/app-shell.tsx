'use client';

import { Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { Fragment, type ReactNode } from 'react';
import { cn } from '../../cn';
import { useTranslations } from '../../intl';

export type NavigationItem = {
  href: string;
  label: string;
  icon?: ReactNode;
  /** Defaults to the current path being exactly `href`. */
  active?: boolean;
  /** Sub-pages, shown as an indented sub-tree only while this item or one of them is current. */
  children?: NavigationItem[];
};

/** A labelled section of the sidebar ("Sales channels"); the first group usually has no label. */
export type NavigationGroup = { label?: string; items: NavigationItem[] };

function isCurrent(item: NavigationItem, pathname: string | null): boolean {
  return item.active ?? pathname === item.href;
}

function NavigationLink({
  item,
  current,
  nested,
}: {
  item: NavigationItem;
  current: boolean;
  nested?: boolean;
}) {
  return (
    <Link
      href={item.href}
      aria-current={current ? 'page' : undefined}
      className={cn(
        'flex items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground hover:bg-muted aria-[current=page]:bg-muted aria-[current=page]:font-semibold [&_svg]:size-4',
        nested && 'py-1.5 ps-9 text-muted-foreground aria-[current=page]:text-foreground',
      )}
    >
      {item.icon}
      {item.label}
    </Link>
  );
}

function Navigation({ groups, label }: { groups: NavigationGroup[]; label: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="flex flex-col gap-4 p-2">
      {groups.map((group, index) => (
        <div key={group.label ?? index} className="flex flex-col gap-1">
          {group.label ? (
            <p className="px-3 pt-1 text-xs font-semibold text-muted-foreground">{group.label}</p>
          ) : null}
          {group.items.map((item) => {
            const childCurrent =
              item.children?.some((child) => isCurrent(child, pathname)) ?? false;
            const open = isCurrent(item, pathname) || childCurrent;
            return (
              <Fragment key={`${item.href} ${item.label}`}>
                <NavigationLink item={item} current={isCurrent(item, pathname)} />
                {open && item.children?.length
                  ? item.children.map((child) => (
                      <NavigationLink
                        key={`${child.href} ${child.label}`}
                        item={child}
                        current={isCurrent(child, pathname)}
                        nested
                      />
                    ))
                  : null}
              </Fragment>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/**
 * The application frame (web §6, ADR-0033; design references in docs/references/design/WEB-1.md):
 * navigation on the start side (right in Arabic, left in English, by flex order and logical borders
 * only) with the account block at its top, grouped items whose sub-pages unfold under the current
 * one, and an optional primary action fixed at its bottom; a top bar with a search slot and, at the
 * end, the locale switch and user slot; the page in `<main>`. Below `md` the navigation opens as a
 * sheet from the start edge. A skip link leads to the content. With no navigation (sign-in and
 * recipient pages) the frame is the top bar alone.
 */
export function AppShell({
  brand,
  navigation,
  account,
  sidebarAction,
  search,
  topBar,
  children,
}: {
  brand: ReactNode;
  navigation: NavigationGroup[];
  /** Top of the sidebar: the current account (WEB-2). */
  account?: ReactNode;
  /** Bottom of the sidebar, always visible: the area's primary action. */
  sidebarAction?: ReactNode;
  /** Middle of the top bar: global search. */
  search?: ReactNode;
  /** End of the top bar: the locale switch and, from WEB-2, the user menu. */
  topBar?: ReactNode;
  children: ReactNode;
}) {
  const t = useTranslations('common.shell');
  const tNav = useTranslations('nav');
  const hasNavigation = navigation.some((group) => group.items.length > 0);
  const sidebar = (
    <>
      {account ? <div className="px-3 pb-2">{account}</div> : null}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Navigation groups={navigation} label={tNav('primary')} />
      </div>
      {sidebarAction ? <div className="border-t border-border p-3">{sidebarAction}</div> : null}
    </>
  );
  return (
    <div className="flex min-h-dvh bg-background text-foreground">
      <a
        href="#main"
        className="sr-only rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-50"
      >
        {t('skip_to_content')}
      </a>
      {hasNavigation ? (
        <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-e border-border bg-surface md:flex">
          <div className="flex h-14 shrink-0 items-center px-5 font-semibold">{brand}</div>
          {sidebar}
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
                  <div className="flex h-14 shrink-0 items-center justify-between px-5">
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
                  {sidebar}
                </DialogPrimitive.Content>
              </DialogPrimitive.Portal>
            </DialogPrimitive.Root>
          ) : null}
          <div className={cn('font-semibold', hasNavigation && 'md:hidden')}>{brand}</div>
          {search ? <div className="mx-auto hidden w-full max-w-md md:block">{search}</div> : null}
          <div className="ms-auto flex items-center gap-2">{topBar}</div>
        </header>
        <main id="main" tabIndex={-1} className="flex-1 p-4 outline-none md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}

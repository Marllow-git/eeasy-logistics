import { messages } from '@eeasy-logistics/i18n';
import { fireEvent, screen, within } from '@testing-library/react';
import type * as NextNavigation from 'next/navigation';
import { Direction } from 'radix-ui';
import { describe, expect, it, vi } from 'vitest';
import { AppShell } from '../src/components/app-shell/app-shell';
import { directions, renderIn, wrapIn } from './render';

// The current path, switchable per test (a route change is a new `usePathname()` value); null, as
// outside an App Router tree, unless a test sets it.
const route = vi.hoisted(() => ({ pathname: null as string | null }));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof NextNavigation>()),
  usePathname: () => route.pathname,
}));

function ReadDirection() {
  return <output>{Direction.useDirection()}</output>;
}

describe.each(directions)('frame in $locale ($dir)', ({ locale, dir }) => {
  const { common, nav } = messages[locale];

  it('DirectionProvider gives Radix the reading direction', () => {
    renderIn(locale, <ReadDirection />);
    expect(screen.getByRole('status').textContent).toBe(dir);
  });

  it('AppShell has a skip link, labelled navigation, the current page and the top bar', () => {
    renderIn(
      locale,
      <AppShell
        brand="Eeasy"
        navigation={[
          {
            items: [
              { href: '/', label: nav.home, active: false },
              {
                href: '/orders',
                label: 'Orders',
                active: true,
                children: [{ href: '/orders/drafts', label: 'Drafts', active: false }],
              },
              {
                href: '/drivers',
                label: 'Drivers',
                active: false,
                children: [{ href: '/drivers/shifts', label: 'Shifts', active: false }],
              },
            ],
          },
          { label: 'Channels', items: [{ href: '/channels', label: 'Stores', active: false }] },
        ]}
        account={<p>Account block</p>}
        sidebarAction={<button type="button">New order</button>}
        search={<input type="search" aria-label="Search" />}
        topBar={<button type="button">Lang</button>}
      >
        <p>Content</p>
      </AppShell>,
    );
    expect(
      screen.getByRole('link', { name: common.shell.skip_to_content }).getAttribute('href'),
    ).toBe('#main');
    const navigation = screen.getByRole('navigation', { name: nav.primary });
    expect(
      within(navigation).getByRole('link', { name: 'Orders' }).getAttribute('aria-current'),
    ).toBe('page');
    expect(
      within(navigation).getByRole('link', { name: nav.home }).getAttribute('aria-current'),
    ).toBeNull();
    // Sub-pages unfold only under the current item (Shopify reference, plan §8.2).
    expect(within(navigation).getByRole('link', { name: 'Drafts' }).className).toContain('ps-9');
    expect(within(navigation).queryByRole('link', { name: 'Shifts' })).toBeNull();
    expect(within(navigation).getByText('Channels')).toBeTruthy();
    // Account block on top, primary action at the bottom of the sidebar (Square reference).
    const aside = navigation.closest('aside')!;
    expect(within(aside).getByText('Account block')).toBeTruthy();
    expect(within(aside).getByRole('button', { name: 'New order' })).toBeTruthy();
    expect(
      within(screen.getByRole('banner')).getByRole('searchbox', { name: 'Search' }),
    ).toBeTruthy();
    expect(screen.getByRole('main').id).toBe('main');
    expect(screen.getByRole('button', { name: 'Lang' })).toBeTruthy();
    // The sidebar's edge is logical, so it sits on the right in Arabic and the left in English.
    expect(navigation.closest('aside')?.className).toContain('border-e');
  });

  it('AppShell marks a "prefix" item current on the pages under it, an exact one only on itself', () => {
    // WEB-4 (lead ruling carried from WEB-3 8.3 #6): a list stays current on its detail pages.
    route.pathname = '/accounts/0192';
    renderIn(
      locale,
      <AppShell
        brand="Eeasy"
        navigation={[
          {
            items: [
              { href: '/accounts', label: 'Accounts', match: 'prefix' },
              { href: '/acc', label: 'Acc', match: 'prefix' },
              { href: '/rollout', label: 'Rollout' },
            ],
          },
        ]}
      >
        <p>Content</p>
      </AppShell>,
    );
    const navigation = screen.getByRole('navigation', { name: nav.primary });
    const current = (name: string) =>
      within(navigation).getByRole('link', { name }).getAttribute('aria-current');
    expect(current('Accounts')).toBe('page');
    expect(current('Acc')).toBeNull();
    expect(current('Rollout')).toBeNull();
    route.pathname = null;
  });

  it('AppShell opens the navigation as a sheet from the start edge on small screens', () => {
    renderIn(
      locale,
      <AppShell
        brand="Eeasy"
        navigation={[{ items: [{ href: '/', label: nav.home, active: true }] }]}
      >
        <p>Content</p>
      </AppShell>,
    );
    fireEvent.click(screen.getByRole('button', { name: common.shell.open_navigation }));
    const sheet = screen.getByRole('dialog');
    expect(sheet.className).toContain('start-0');
    expect(within(sheet).getByRole('navigation', { name: nav.primary })).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: common.shell.close_navigation }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('AppShell closes the navigation sheet when a link in it is followed', () => {
    renderIn(
      locale,
      <AppShell
        brand="Eeasy"
        navigation={[
          {
            items: [
              { href: '/', label: nav.home, active: true },
              { href: '/', label: common.shell.account, active: false },
            ],
          },
        ]}
      >
        <p>Content</p>
      </AppShell>,
    );
    fireEvent.click(screen.getByRole('button', { name: common.shell.open_navigation }));
    const sheet = screen.getByRole('dialog');
    // A link to the page already shown changes no path; the click alone must close the sheet.
    fireEvent.click(within(sheet).getByRole('link', { name: common.shell.account }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('AppShell closes the navigation sheet when the route changes', () => {
    route.pathname = '/';
    try {
      // A fresh element per render, as a router re-render gives; the same one would bail out.
      const ui = () => (
        <AppShell brand="Eeasy" navigation={[{ items: [{ href: '/', label: nav.home }] }]}>
          <p>Content</p>
        </AppShell>
      );
      const { rerender } = renderIn(locale, ui());
      fireEvent.click(screen.getByRole('button', { name: common.shell.open_navigation }));
      expect(screen.getByRole('dialog')).toBeTruthy();
      route.pathname = '/orders';
      rerender(wrapIn(locale, ui()));
      expect(screen.queryByRole('dialog')).toBeNull();
    } finally {
      route.pathname = null;
    }
  });
});

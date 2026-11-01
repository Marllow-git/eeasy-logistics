import { messages } from '@eeasy-logistics/i18n';
import { fireEvent, screen, within } from '@testing-library/react';
import { Direction } from 'radix-ui';
import { describe, expect, it } from 'vitest';
import { AppShell } from '../src/components/app-shell/app-shell';
import { directions, renderIn } from './render';

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
          { href: '/', label: nav.home, active: true },
          { href: '/orders', label: 'Orders' },
        ]}
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
      within(navigation).getByRole('link', { name: nav.home }).getAttribute('aria-current'),
    ).toBe('page');
    expect(
      within(navigation).getByRole('link', { name: 'Orders' }).getAttribute('aria-current'),
    ).toBeNull();
    expect(screen.getByRole('main').id).toBe('main');
    expect(screen.getByRole('button', { name: 'Lang' })).toBeTruthy();
    // The sidebar's edge is logical, so it sits on the right in Arabic and the left in English.
    expect(navigation.closest('aside')?.className).toContain('border-e');
  });

  it('AppShell opens the navigation as a sheet from the start edge on small screens', () => {
    renderIn(
      locale,
      <AppShell brand="Eeasy" navigation={[{ href: '/', label: nav.home, active: true }]}>
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
});

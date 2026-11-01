import { messages } from '@eeasy-logistics/i18n';
import { act, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BilingualInput } from '../src/components/bilingual-input/bilingual-input';
import { BilingualText } from '../src/components/bilingual-text/bilingual-text';
import { DateTime } from '../src/components/date-time/date-time';
import { Money } from '../src/components/money/money';
import { OrderNumber } from '../src/components/order-number/order-number';
import { Phone } from '../src/components/phone/phone';
import { StatusChip } from '../src/components/status-chip/status-chip';
import { UpdatedAgo } from '../src/components/updated-ago/updated-ago';
import { statusStates, type StatusMachine } from '../src/status';
import { arabicIndicDigits, directions, renderIn } from './render';

describe.each(directions)('data display in $locale ($dir)', ({ locale }) => {
  const common = messages[locale].common;

  it('Money puts the riyal sign where Intl puts the currency, with a no-break space', () => {
    const { container } = renderIn(locale, <Money halalas={15000} />);
    const money = container.firstElementChild!;
    const [first, second] = [...money.children];
    // Arabic: amount then sign (150.00 SAR); English: sign then amount (SAR 150.00).
    const [digits, sign] = locale === 'ar' ? [first, second] : [second, first];
    expect(digits?.tagName).toBe('BDI');
    expect(digits?.getAttribute('dir')).toBe('ltr');
    expect(digits?.textContent).toBe('150.00');
    expect(sign?.tagName.toLowerCase()).toBe('svg');
    expect(sign?.getAttribute('aria-hidden')).toBe('true');
    // The SVG has no text, so the text is the digits and the no-break space in Intl's order.
    const visible = locale === 'ar' ? '150.00\u00a0' : '\u00a0150.00';
    expect(money.textContent).toBe(`${visible}${common.currency.sar}`);
    expect(container.textContent).not.toMatch(arabicIndicDigits);
  });

  it('DateTime shows an instant in Riyadh and a business date on its own day', () => {
    const { container } = renderIn(
      locale,
      <>
        <DateTime value="2026-03-01T21:30:00Z" dateStyle="short" timeStyle="short" />
        <DateTime date="2026-03-01" dateStyle="long" />
      </>,
    );
    const [instant, day] = [...container.querySelectorAll('time')];
    expect(instant?.getAttribute('datetime')).toBe('2026-03-01T21:30:00.000Z');
    expect(instant?.textContent).toContain('12:30');
    expect(day?.getAttribute('datetime')).toBe('2026-03-01');
    expect(day?.textContent).toContain('2026');
    expect(container.textContent).not.toMatch(arabicIndicDigits);
  });

  it('Phone and OrderNumber render inside left-to-right isolates', () => {
    const { container } = renderIn(
      locale,
      <>
        <Phone e164="+966501234567" />
        <OrderNumber value="ORD-2026-0042" />
      </>,
    );
    const [phone, order] = [...container.querySelectorAll('bdi')];
    expect(phone?.getAttribute('dir')).toBe('ltr');
    expect(phone?.textContent).toBe('‎+966 50 123 4567‎');
    expect(order?.getAttribute('dir')).toBe('ltr');
    expect(order?.textContent).toBe('ORD-2026-0042');
  });

  it('BilingualText shows the own language, else the other marked with lang and dir', () => {
    const { container } = renderIn(
      locale,
      <>
        <BilingualText ar="الرياض" en="Riyadh" />
        <BilingualText {...(locale === 'ar' ? { en: 'Only English' } : { ar: 'عربي فقط' })} />
        <BilingualText />
      </>,
    );
    const [own, fallback, ...rest] = [...container.querySelectorAll('span')];
    expect(own?.textContent).toBe(locale === 'ar' ? 'الرياض' : 'Riyadh');
    expect(own?.getAttribute('dir')).toBe('auto');
    expect(fallback?.getAttribute('lang')).toBe(locale === 'ar' ? 'en' : 'ar');
    expect(fallback?.getAttribute('dir')).toBe(locale === 'ar' ? 'ltr' : 'rtl');
    expect(rest).toHaveLength(0);
  });

  it('BilingualInput shows Arabic first, each input with its own lang and dir', () => {
    renderIn(locale, <BilingualInput name="name" legend="Site name" />);
    const inputs = screen.getAllByRole('textbox');
    expect(inputs.map((i) => [i.getAttribute('name'), i.lang, i.dir])).toEqual([
      ['name_ar', 'ar', 'rtl'],
      ['name_en', 'en', 'ltr'],
    ]);
    expect(screen.getByLabelText(common.locale.ar)).toBe(inputs[0]);
    expect(screen.getByRole('group', { name: 'Site name' })).toBeTruthy();
  });

  it('StatusChip gives every state an icon, its colour token and its label', () => {
    const chips = (Object.keys(statusStates) as StatusMachine[]).flatMap((machine) =>
      statusStates[machine].map((state) => ({ machine, state })),
    );
    const { container } = renderIn(
      locale,
      <>
        {chips.map(({ machine, state }) => (
          <StatusChip key={`${machine}.${state}`} machine={machine} state={state as never} />
        ))}
      </>,
    );
    const rendered = [...container.querySelectorAll('[data-machine]')];
    expect(rendered).toHaveLength(24);
    for (const chip of rendered) {
      const machine = chip.getAttribute('data-machine') as StatusMachine;
      const state = chip.getAttribute('data-state')!;
      const labels = common.status[machine] as Record<string, string>;
      expect(chip.textContent).toBe(labels[state]);
      expect(chip.className).toContain(`text-(--status-${machine}-${state})`);
      expect(chip.querySelector('svg[aria-hidden]')).toBeTruthy();
    }
  });

  it('StatusChip shows an unknown runtime state neutrally with its raw text and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { container } = renderIn(
      locale,
      <StatusChip machine="order" state={'on_hold' as never} />,
    );
    const chip = container.querySelector('[data-machine="order"]')!;
    expect(chip.textContent).toBe('on_hold');
    expect(chip.className).toContain('text-muted-foreground');
    expect(chip.querySelector('svg[aria-hidden]')).toBeTruthy();
    expect(warn).toHaveBeenCalledWith('StatusChip: unknown order state "on_hold"');
    warn.mockRestore();
  });

  it('UpdatedAgo keeps one interval while it ticks every second, and one after the minute', () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    try {
      renderIn(locale, <UpdatedAgo at={new Date(Date.now() - 50_000)} />);
      act(() => {
        vi.advanceTimersByTime(5_000);
      });
      expect(setIntervalSpy).toHaveBeenCalledTimes(1);
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      // Past the first minute: one more interval at the thirty-second cadence, then no more.
      act(() => {
        vi.advanceTimersByTime(90_000);
      });
      expect(setIntervalSpy).toHaveBeenCalledTimes(2);
      expect(setIntervalSpy.mock.calls.map((call) => call[1])).toEqual([1000, 30_000]);
    } finally {
      setIntervalSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('UpdatedAgo counts seconds, minutes and hours with Western digits', () => {
    const at = Date.parse('2026-03-01T09:00:00Z');
    const { container } = renderIn(
      locale,
      <>
        <UpdatedAgo at={new Date(at)} now={at + 2_000} />
        <UpdatedAgo at={new Date(at)} now={at + 12_000} />
        <UpdatedAgo at={new Date(at)} now={at + 120_000} />
        <UpdatedAgo at={new Date(at)} now={at + 3 * 3_600_000} />
      </>,
    );
    const texts = [...container.querySelectorAll('time')].map((t) => t.textContent);
    expect(texts[0]).toBe(common.updated_ago.just_now);
    if (locale === 'en') {
      expect(texts.slice(1)).toEqual([
        'Updated 12 seconds ago',
        'Updated 2 minutes ago',
        'Updated 3 hours ago',
      ]);
    } else {
      expect(texts.slice(1)).toEqual([
        'حُدّث قبل 12 ثانية',
        'حُدّث قبل دقيقتين',
        'حُدّث قبل 3 ساعات',
      ]);
    }
    expect(container.textContent).not.toMatch(arabicIndicDigits);
  });
});

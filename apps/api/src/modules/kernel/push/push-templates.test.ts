import {
  locales,
  pushTemplateKeys as catalogueKeys,
  pushTemplateTexts,
} from '@eeasy-logistics/i18n/push';
import { describe, expect, it } from 'vitest';
import {
  PushParamsError,
  pushParamsProblem,
  pushPlaceholdersOf,
  pushTemplateKeys,
  pushTemplates,
  renderPush,
} from './push-templates.js';

// INT-4 plan 2.7, 2.10: the registry matches the catalogue, renders in both locales with Western
// digits, and refuses any parameter it does not declare.

const arabicIndicDigits = /[٠-٩۰-۹]/;

describe('push template registry', () => {
  it('has exactly the catalogue keys', () => {
    expect([...pushTemplateKeys].sort()).toEqual([...catalogueKeys].sort());
  });

  it.each(locales)('declares exactly the placeholders of every text in %s', (locale) => {
    for (const key of pushTemplateKeys) {
      const texts = pushTemplateTexts[locale][key];
      const used = new Set([...pushPlaceholdersOf(texts.title), ...pushPlaceholdersOf(texts.body)]);
      expect([...used].sort(), `${locale} ${key}`).toEqual(
        Object.keys(pushTemplates[key].params).sort(),
      );
    }
  });

  it('sends offers and cash on their high-priority channels with sound, run changes quietly', () => {
    expect(pushTemplates.offer_received).toMatchObject({
      channelId: 'offers',
      priority: 'high',
      sound: true,
    });
    expect(pushTemplates.cash_block_notice).toMatchObject({
      channelId: 'cash',
      priority: 'high',
      sound: true,
    });
    for (const key of ['order_assigned', 'order_cancelled', 'sync_needed'] as const) {
      expect(pushTemplates[key]).toMatchObject({
        channelId: 'run',
        priority: 'default',
        sound: false,
      });
    }
  });
});

describe('renderPush', () => {
  it('renders the offer in Arabic and English with Western digits', () => {
    const ar = renderPush('offer_received', 'ar', { expires_in_min: '12' });
    const en = renderPush('offer_received', 'en', { expires_in_min: '12' });
    expect(ar.title).toBe('عرض توصيل جديد');
    expect(ar.body).toContain('12');
    expect(`${ar.title}${ar.body}`).not.toMatch(arabicIndicDigits);
    expect(en).toEqual({
      title: 'New delivery offer',
      body: 'You have a new offer. Minutes left to accept: 12',
    });
  });

  it('passes an order reference through unchanged', () => {
    expect(renderPush('order_assigned', 'en', { order_number: 'D-000123' }).body).toBe(
      'Order D-000123 was assigned to you.',
    );
    expect(renderPush('order_cancelled', 'ar', { order_number: 'D-000123' }).body).toContain(
      'D-000123',
    );
  });

  it('renders templates without parameters', () => {
    expect(renderPush('sync_needed', 'en', {})).toEqual({
      title: 'Sync needed',
      body: 'Open the app to sync your data.',
    });
  });

  it('throws for parameters that do not fit', () => {
    expect(() => renderPush('sync_needed', 'en', { name: 'Sara' })).toThrow(PushParamsError);
  });
});

describe('pushParamsProblem', () => {
  it('accepts the declared parameters', () => {
    expect(pushParamsProblem('offer_received', { expires_in_min: '0' })).toBeUndefined();
    expect(pushParamsProblem('order_assigned', { order_number: 'D-1' })).toBeUndefined();
    expect(pushParamsProblem('cash_block_notice', {})).toBeUndefined();
  });

  it('refuses an undeclared parameter: no name, phone or address can ride along', () => {
    expect(pushParamsProblem('order_assigned', { order_number: 'D-1', name: 'Sara' })).toBe(
      'unknown parameter name',
    );
    expect(pushParamsProblem('sync_needed', { phone: '+966500000000' })).toBe(
      'unknown parameter phone',
    );
  });

  it('refuses a missing or empty parameter', () => {
    expect(pushParamsProblem('offer_received', {})).toBe('parameter expires_in_min is missing');
    expect(pushParamsProblem('offer_received', { expires_in_min: '' })).toBe(
      'parameter expires_in_min is missing',
    );
  });

  it('refuses a line break, a value over 80 characters, and a value not of its kind', () => {
    expect(pushParamsProblem('order_assigned', { order_number: 'D-1\nX' })).toBe(
      'parameter order_number carries a line break',
    );
    expect(pushParamsProblem('order_assigned', { order_number: 'D'.repeat(81) })).toBe(
      'parameter order_number is longer than 80 characters',
    );
    expect(pushParamsProblem('order_assigned', { order_number: 'Riyadh Olaya St' })).toBe(
      'parameter order_number is not a reference',
    );
    expect(pushParamsProblem('offer_received', { expires_in_min: '١٢' })).toBe(
      'parameter expires_in_min is not a count',
    );
    expect(pushParamsProblem('offer_received', { expires_in_min: '-3' })).toBe(
      'parameter expires_in_min is not a count',
    );
  });
});

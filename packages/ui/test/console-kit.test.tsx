import { messages } from '@eeasy-logistics/i18n';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Banner } from '../src/components/banner/banner';
import { ReasonDialog } from '../src/components/reason-dialog/reason-dialog';
import { SegmentedChoice } from '../src/components/segmented-choice/segmented-choice';
import { arabicIndicDigits, directions, renderIn } from './render';

// WEB-4 item B: the reason dialog (bounds, prefill, the trimmed reason with the intent's key, a
// refusal kept inside), the segmented choice (radio semantics in the reading direction) and the
// banner (a named region in its tone with its action), in both reading directions.

const uuidV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function Reasoning(props: {
  onConfirm: (reason: string, key: string) => Promise<void>;
  initialReason?: string;
  ready?: boolean;
  max?: number;
  measure?: (reason: string) => number;
}) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <p data-testid="state">{open ? 'open' : 'closed'}</p>
      <ReasonDialog
        open={open}
        onOpenChange={setOpen}
        title="Suspend متجر الخبر?"
        consequences={['Staff are signed out']}
        confirmLabel="Suspend"
        max={props.max ?? 500}
        initialReason={props.initialReason}
        ready={props.ready}
        measure={props.measure}
        onConfirm={props.onConfirm}
      />
    </>
  );
}

describe.each(directions)('console kit in $locale ($dir)', ({ locale }) => {
  const reason = messages[locale].common.reason;

  it('ReasonDialog holds the confirm until the reason has five characters', async () => {
    const onConfirm = vi.fn(() => Promise.resolve());
    renderIn(locale, <Reasoning onConfirm={onConfirm} />);
    const dialog = screen.getByRole('alertdialog');
    const confirm = within(dialog).getByRole('button', { name: 'Suspend' });
    const field = within(dialog).getByRole('textbox', { name: reason.label });
    expect(confirm).toHaveProperty('disabled', true);
    expect(dialog.textContent).toContain(reason.too_short.replace('{min}', '5'));
    fireEvent.change(field, { target: { value: '   abcd   ' } });
    expect(confirm).toHaveProperty('disabled', true);
    fireEvent.change(field, { target: { value: '  late payment  ' } });
    expect(confirm).toHaveProperty('disabled', false);
    expect(dialog.textContent).toContain('12 / 500');
    expect(dialog.textContent).not.toMatch(arabicIndicDigits);
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('closed'));
    expect(onConfirm).toHaveBeenCalledWith('late payment', expect.stringMatching(uuidV7));
  });

  it('ReasonDialog prefills the tab reason, bounds the field and keeps a refusal inside', async () => {
    const onConfirm = vi.fn(() => Promise.reject(new Error('refused')));
    renderIn(locale, <Reasoning onConfirm={onConfirm} initialReason="Ticket 4411" max={200} />);
    const dialog = screen.getByRole('alertdialog');
    const field = within(dialog).getByRole('textbox', { name: reason.label });
    expect(field).toHaveProperty('value', 'Ticket 4411');
    expect(field.getAttribute('maxlength')).toBe('200');
    expect(field.getAttribute('dir')).toBe('auto');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Suspend' }));
    await waitFor(() => expect(within(dialog).getByRole('alert')).toBeTruthy());
    expect(screen.getByTestId('state').textContent).toBe('open');
    // The same intent keeps its key on a retry.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Suspend' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(2));
    const calls = onConfirm.mock.calls as unknown as [string, string][];
    expect(calls[1]![1]).toBe(calls[0]![1]);
  });

  it('ReasonDialog measures as the door does and waits for what else must hold', () => {
    renderIn(
      locale,
      <Reasoning
        onConfirm={() => Promise.resolve()}
        initialReason="بلاغ رقم 4411 من التاجر"
        max={20}
        measure={(text) => encodeURIComponent(text.trim()).length}
        ready={false}
      />,
    );
    const dialog = screen.getByRole('alertdialog');
    const field = within(dialog).getByRole('textbox', { name: reason.label });
    expect(field.getAttribute('maxlength')).toBeNull();
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(dialog.textContent).toContain(reason.too_long.replace('{max}', '20'));
    expect(within(dialog).getByRole('button', { name: 'Suspend' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('SegmentedChoice is one radio group with the selected value checked', () => {
    const onValueChange = vi.fn();
    renderIn(
      locale,
      <SegmentedChoice
        label="delivery"
        options={[
          { value: 'off', label: 'Off' },
          { value: 'allowlist', label: 'Allowlist' },
          { value: 'all', label: 'All' },
        ]}
        value="allowlist"
        onValueChange={onValueChange}
      />,
    );
    const group = screen.getByRole('radiogroup', { name: 'delivery' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((radio) => radio.getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'false',
    ]);
    expect(group.getAttribute('dir')).toBe(locale === 'ar' ? 'rtl' : 'ltr');
    fireEvent.click(within(group).getByRole('radio', { name: 'All' }));
    expect(onValueChange).toHaveBeenCalledWith('all');
  });

  it('SegmentedChoice disabled takes no change', () => {
    const onValueChange = vi.fn();
    renderIn(
      locale,
      <SegmentedChoice
        label="wms"
        options={[
          { value: 'off', label: 'Off' },
          { value: 'all', label: 'All' },
        ]}
        value="off"
        onValueChange={onValueChange}
        disabled
      />,
    );
    const all = screen.getByRole('radio', { name: 'All' });
    expect(all).toHaveProperty('disabled', true);
    fireEvent.click(all);
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('Banner is a named region in its tone with its action at the end', () => {
    renderIn(
      locale,
      <Banner
        tone="support"
        label="Acting on account"
        title="متجر الخبر"
        actions={<button type="button">Exit account</button>}
      >
        Reason: Ticket 4411
      </Banner>,
    );
    const region = screen.getByRole('region', { name: 'Acting on account' });
    expect(region.className).toContain('bg-support');
    expect(region.className).toContain('text-support-foreground');
    expect(region.textContent).toContain('Reason: Ticket 4411');
    expect(within(region).getByRole('button', { name: 'Exit account' })).toBeTruthy();
    // Logical spacing only: nothing pins the action to a physical side.
    expect(region.innerHTML).not.toMatch(/\b(?:ml|mr|pl|pr|left|right)-/);
  });
});

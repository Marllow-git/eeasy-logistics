import { messages } from '@eeasy-logistics/i18n';
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CodeBlock, codeText } from '../src/components/code-block/code-block';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '../src/components/sheet/sheet';
import { directions, renderIn } from './render';

// WEB-4 item D: the outbox drawer's pieces in both reading directions: the sheet is a named modal
// dialog at the end edge that closes with its labelled button, and the code block keeps machine
// text left to right, JSON indented, under its caption.

describe.each(directions)('outbox drawer kit in $locale ($dir)', ({ locale }) => {
  it('Sheet is a named dialog with a localised close button', () => {
    renderIn(
      locale,
      <Sheet defaultOpen>
        <SheetContent>
          <SheetTitle>webhook · dead</SheetTitle>
          <SheetDescription>متجر نجران</SheetDescription>
          <p>body</p>
        </SheetContent>
      </Sheet>,
    );
    const dialog = screen.getByRole('dialog', { name: 'webhook · dead' });
    expect(dialog.className).toContain('end-0');
    expect(dialog.className).not.toMatch(/\b(left|right)-0\b/);
    const close = within(dialog).getByRole('button', {
      name: messages[locale].common.actions.close,
    });
    fireEvent.click(close);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('CodeBlock prints JSON indented, left to right, under its caption', () => {
    renderIn(locale, <CodeBlock label="Payload" value={{ order_id: 'A-1', amount: 25 }} />);
    const block = screen.getByLabelText('Payload');
    expect(block.tagName).toBe('PRE');
    expect(block.getAttribute('dir')).toBe('ltr');
    expect(block.textContent).toBe('{\n  "order_id": "A-1",\n  "amount": 25\n}');
  });
});

describe('codeText', () => {
  it('keeps a string as it is and prints nothing for undefined', () => {
    expect(codeText('500 endpoint failed')).toBe('500 endpoint failed');
    expect(codeText(undefined)).toBe('');
    expect(codeText(null)).toBe('null');
  });
});

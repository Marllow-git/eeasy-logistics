import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DateFilter } from '../src/table/filters';
import { directions, renderIn } from './render';

// WEB-3 leg 2, item F: the date filter of the audit log, in both reading directions.

describe.each(directions)('DateFilter in $locale ($dir)', ({ locale }) => {
  it('reports the picked day, and none when cleared, left to right', () => {
    const change = vi.fn();
    renderIn(
      locale,
      <DateFilter label="From" value="2026-11-01" min="2026-10-01" onChange={change} />,
    );
    const input = screen.getByLabelText('From');
    expect(input.getAttribute('type')).toBe('date');
    expect(input.getAttribute('dir')).toBe('ltr');
    expect(input.getAttribute('min')).toBe('2026-10-01');
    expect((input as HTMLInputElement).value).toBe('2026-11-01');
    fireEvent.change(input, { target: { value: '2026-11-02' } });
    expect(change).toHaveBeenLastCalledWith('2026-11-02');
    fireEvent.change(input, { target: { value: '' } });
    expect(change).toHaveBeenLastCalledWith(undefined);
  });
});

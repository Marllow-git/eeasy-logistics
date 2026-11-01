import { messages } from '@eeasy-logistics/i18n';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ErrorState } from '../src/components/error-state/error-state';
import { arabicIndicDigits, directions, renderIn } from './render';

// The shared error page of web §10.4 (PLAT-14 item F): heading, one line, the reference as copyable
// text, retry and home, in both reading directions.

describe.each(directions)('ErrorState in $locale ($dir)', ({ locale }) => {
  const labels = messages[locale].common.error_page;

  it('shows the heading, the help line, the reference, retry and home', () => {
    const onRetry = vi.fn();
    renderIn(
      locale,
      <ErrorState labels={labels} reference="2853647186" onRetry={onRetry} homeHref="/" />,
    );
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(labels.title);
    expect(screen.getByText(labels.description)).toBeTruthy();
    const reference = screen.getByTestId('error-reference');
    expect(reference.textContent).toBe('2853647186');
    expect(reference.getAttribute('dir')).toBe('ltr');
    expect(document.body.textContent).not.toMatch(arabicIndicDigits);
    fireEvent.click(screen.getByRole('button', { name: labels.retry }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.getByRole('link', { name: labels.home }).getAttribute('href')).toBe('/');
  });

  it('copies the reference and says so', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderIn(locale, <ErrorState labels={labels} reference="abc123" />);
    fireEvent.click(screen.getByRole('button', { name: labels.copy }));
    expect(writeText).toHaveBeenCalledWith('abc123');
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(labels.copied));
    expect(screen.getByRole('button', { name: labels.copied })).toBeTruthy();
  });

  it('leaves out what it was not given (no reference, no home on recipient pages)', () => {
    renderIn(locale, <ErrorState labels={labels} variant="page" />);
    expect(screen.queryByTestId('error-reference')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

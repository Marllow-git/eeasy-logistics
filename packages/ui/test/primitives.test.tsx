import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Badge } from '../src/components/badge/badge';
import { Button } from '../src/components/button/button';
import { Card, CardContent, CardHeader, CardTitle } from '../src/components/card/card';
import { Input } from '../src/components/input/input';
import { Label } from '../src/components/label/label';
import { PageHeader } from '../src/components/page-header/page-header';
import { Skeleton } from '../src/components/skeleton/skeleton';
import { directions, renderIn } from './render';

describe.each(directions)('primitives in $locale ($dir)', ({ locale, dir }) => {
  it('Button renders a button, and a link with asChild', () => {
    renderIn(
      locale,
      <>
        <Button variant="secondary">Save</Button>
        <Button asChild>
          <a href="/orders">Orders</a>
        </Button>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Save' }).className).toContain('border-input');
    expect(screen.getByRole('link', { name: 'Orders' }).className).toContain('bg-primary');
    expect(document.documentElement.dir).toBe(dir);
  });

  it('Input and Label are associated, and an ltr field stays ltr in both locales', () => {
    renderIn(
      locale,
      <>
        <Label htmlFor="phone">Phone</Label>
        <Input id="phone" type="tel" dir="ltr" />
      </>,
    );
    const input = screen.getByLabelText('Phone');
    expect(input.getAttribute('dir')).toBe('ltr');
    expect(input.getAttribute('type')).toBe('tel');
  });

  it('Badge renders its text with the tone class', () => {
    renderIn(locale, <Badge tone="success">OK</Badge>);
    expect(screen.getByText('OK').className).toContain('bg-success');
  });

  it('Skeleton is hidden from assistive technology', () => {
    const { container } = renderIn(locale, <Skeleton className="h-4" />);
    expect(container.querySelector('[aria-hidden]')?.className).toContain('animate-pulse');
  });

  it('Card renders a titled section', () => {
    renderIn(
      locale,
      <Card aria-labelledby="t">
        <CardHeader>
          <CardTitle id="t">Today</CardTitle>
        </CardHeader>
        <CardContent>Body</CardContent>
      </Card>,
    );
    expect(screen.getByRole('region', { name: 'Today' })).toBeTruthy();
  });

  it('PageHeader renders the one h1, the description and the actions', () => {
    renderIn(
      locale,
      <PageHeader title="Orders" description="All orders" actions={<Button>New</Button>} />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Orders' })).toBeTruthy();
    expect(screen.getByText('All orders')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New' })).toBeTruthy();
  });

  it('PageHeader renders a tab row under the title', () => {
    renderIn(locale, <PageHeader title="Orders" tabs={<nav aria-label="States">All</nav>} />);
    const header = screen.getByRole('heading', { level: 1 }).closest('header')!;
    expect(header.lastElementChild?.getAttribute('aria-label')).toBe('States');
  });
});

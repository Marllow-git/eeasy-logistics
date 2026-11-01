import { messages } from '@eeasy-logistics/i18n';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../src/components/dialog/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../src/components/dropdown-menu/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../src/components/select/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../src/components/tabs/tabs';
import {
  Toast,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from '../src/components/toast/toast';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../src/components/tooltip/tooltip';
import { directions, renderIn } from './render';

describe.each(directions)('overlays in $locale ($dir)', ({ locale, dir }) => {
  const close = messages[locale].common.actions.close;

  it('Dialog is a labelled modal with a localised close button', () => {
    renderIn(
      locale,
      <Dialog defaultOpen>
        <DialogContent>
          <DialogTitle>Title</DialogTitle>
          <DialogDescription>Text</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByRole('dialog', { name: 'Title' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: close }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('DropdownMenu opens its menu in the reading direction', () => {
    renderIn(
      locale,
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>One</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(screen.getByRole('menu').getAttribute('dir')).toBe(dir);
    expect(screen.getByRole('menuitem', { name: 'One' })).toBeTruthy();
  });

  it('Tooltip shows its content', () => {
    renderIn(
      locale,
      <TooltipProvider>
        <Tooltip open>
          <TooltipTrigger>Hover</TooltipTrigger>
          <TooltipContent>Help</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    expect(screen.getByRole('tooltip').textContent).toBe('Help');
  });

  it('Toast swipes towards the end edge and has a localised close button', () => {
    renderIn(
      locale,
      <ToastProvider>
        <Toast open>
          <ToastTitle>Saved</ToastTitle>
          <ToastDescription>Done</ToastDescription>
        </Toast>
        <ToastViewport />
      </ToastProvider>,
    );
    const toast = screen.getByText('Saved').closest('[data-swipe-direction]');
    expect(toast?.getAttribute('data-swipe-direction')).toBe(dir === 'rtl' ? 'left' : 'right');
    expect(screen.getByRole('button', { name: close })).toBeTruthy();
  });

  it('Select lists its options in the reading direction', () => {
    renderIn(
      locale,
      <Select defaultOpen defaultValue="a">
        <SelectTrigger aria-label="Pick">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">Alpha</SelectItem>
          <SelectItem value="b">Beta</SelectItem>
        </SelectContent>
      </Select>,
    );
    const listbox = screen.getByRole('listbox');
    expect(listbox.closest('[dir]')?.getAttribute('dir')).toBe(dir);
    expect(screen.getByRole('option', { name: 'Beta' })).toBeTruthy();
  });

  it('Tabs move to the next tab with the arrow that points forward in the reading direction', async () => {
    renderIn(
      locale,
      <Tabs defaultValue="one">
        <TabsList>
          <TabsTrigger value="one">One</TabsTrigger>
          <TabsTrigger value="two">Two</TabsTrigger>
          <TabsTrigger value="three">Three</TabsTrigger>
        </TabsList>
        <TabsContent value="one">First</TabsContent>
        <TabsContent value="two">Second</TabsContent>
        <TabsContent value="three">Third</TabsContent>
      </Tabs>,
    );
    const first = screen.getByRole('tab', { name: 'One' });
    first.focus();
    fireEvent.keyDown(first, { key: dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight' });
    // Radix moves roving focus in a timeout. The wrong arrow would loop back to "Three".
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Two' })),
    );
  });
});

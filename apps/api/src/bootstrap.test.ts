import { describe, expect, it } from 'vitest';
import { BootstrapUsageError, parseBootstrapArgs } from './bootstrap.js';
import { parseRole } from './role.js';

describe('--role bootstrap arguments (PLAT-11 plan 2.12)', () => {
  it('is a process role', () => {
    expect(parseRole(['--role', 'bootstrap'])).toBe('bootstrap');
    expect(parseRole(['--role=bootstrap'])).toBe('bootstrap');
  });

  it('reads email (lower-cased), name and locale in both spellings', () => {
    expect(
      parseBootstrapArgs([
        '--role',
        'bootstrap',
        '--email',
        'Root@Example.Test',
        '--name',
        ' Nora ',
      ]),
    ).toEqual({ email: 'root@example.test', name: 'Nora', locale: 'en' });
    expect(
      parseBootstrapArgs(['--email=root@example.test', '--name=Nora Saleh', '--locale=ar']),
    ).toEqual({ email: 'root@example.test', name: 'Nora Saleh', locale: 'ar' });
  });

  it.each([
    [['--name', 'Nora']],
    [['--email', 'not-an-email', '--name', 'Nora']],
    [['--email', 'root@example.test']],
    [['--email', 'root@example.test', '--name', '   ']],
    [['--email', 'root@example.test', '--name', 'Nora', '--locale', 'fr']],
  ])('refuses %j with the usage line', (args) => {
    expect(() => parseBootstrapArgs(args)).toThrow(BootstrapUsageError);
    expect(() => parseBootstrapArgs(args)).toThrow(/Usage: --role bootstrap --email/);
  });
});

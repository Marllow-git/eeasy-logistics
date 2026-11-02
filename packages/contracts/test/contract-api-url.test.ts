// `--api` and CONTRACT_API_URL resolution of test:contract (PLAT-15 lead review round 2, finding 2).
import { describe, expect, it } from 'vitest';
import { resolveApiUrl, resolveOrigins } from '../scripts/contract-api-url.ts';

const unset = () => ({ apiUrl: undefined });
const fromEnv = () => ({ apiUrl: 'http://127.0.0.1:4000' });
const invalid = {
  ok: false,
  message: '--api must be an absolute http(s) URL without a password, e.g. http://127.0.0.1:3000.',
};

describe('resolveApiUrl', () => {
  it('takes --api, also after the `--` pnpm forwards, over the environment', () => {
    expect(resolveApiUrl(['--', '--api', 'http://127.0.0.1:3000'], fromEnv)).toEqual({
      ok: true,
      apiUrl: 'http://127.0.0.1:3000',
    });
    expect(resolveApiUrl(['--api=https://api.example.test'], unset)).toEqual({
      ok: true,
      apiUrl: 'https://api.example.test',
    });
  });

  it('falls back to CONTRACT_API_URL when --api is absent', () => {
    expect(resolveApiUrl([], fromEnv)).toEqual({ ok: true, apiUrl: 'http://127.0.0.1:4000' });
  });

  it('refuses an --api that is not an http(s) URL, with the same rule as contractTestConfig', () => {
    const values = ['ftp://127.0.0.1', 'javascript:alert(1)', '127.0.0.1:3000', '', 'http://u:p@h'];
    for (const value of values) {
      expect(resolveApiUrl(['--api', value], fromEnv), value).toEqual(invalid);
    }
  });

  it('asks for a URL when neither is given, and refuses unknown flags', () => {
    expect(resolveApiUrl([], unset)).toMatchObject({
      ok: false,
      message: expect.stringContaining('--api') as unknown,
    });
    expect(resolveApiUrl(['--apu', 'x'], unset)).toMatchObject({ ok: false });
  });
});

describe('resolveOrigins (PLAT-11 item I)', () => {
  it('reads the web and admin origins beside --api, and none by default', () => {
    const args = ['--', '--api', 'http://127.0.0.1:3000', '--web-origin', 'http://localhost:3001'];
    expect(resolveOrigins([...args, '--admin-origin=https://admin.example.test'])).toEqual({
      ok: true,
      origins: { staff: 'http://localhost:3001', platform: 'https://admin.example.test' },
    });
    expect(resolveApiUrl([...args], unset)).toEqual({ ok: true, apiUrl: 'http://127.0.0.1:3000' });
    expect(resolveOrigins(['--api', 'http://127.0.0.1:3000'])).toEqual({ ok: true, origins: {} });
  });

  it('refuses anything but an http(s) origin', () => {
    for (const value of ['localhost:3001', 'ftp://h', 'http://h/path', '']) {
      expect(resolveOrigins(['--web-origin', value]), value).toMatchObject({ ok: false });
    }
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { contractTestConfig, parseContractTestConfig } from '../src/contract-test.ts';
import { ConfigError } from '../src/index.ts';

describe('contract-test config (CONTRACT_API_URL)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('parses the API URL into a frozen object', () => {
    const config = parseContractTestConfig({ CONTRACT_API_URL: 'http://127.0.0.1:3000' });
    expect(config).toEqual({ apiUrl: 'http://127.0.0.1:3000' });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('leaves the URL unset when the variable is absent or empty', () => {
    expect(parseContractTestConfig({})).toEqual({ apiUrl: undefined });
    expect(parseContractTestConfig({ CONTRACT_API_URL: '' })).toEqual({ apiUrl: undefined });
  });

  it('refuses a value that is not an http(s) URL, naming the variable only', () => {
    expect(() => parseContractTestConfig({ CONTRACT_API_URL: 'postgres://x' })).toThrow(
      ConfigError,
    );
    try {
      parseContractTestConfig({ CONTRACT_API_URL: 'postgres://secret-host' });
    } catch (error) {
      expect((error as ConfigError).issues.map((issue) => issue.variable)).toEqual([
        'CONTRACT_API_URL',
      ]);
      expect((error as Error).message).not.toContain('secret-host');
    }
  });

  it('reads CONTRACT_API_URL from the process environment', () => {
    vi.stubEnv('CONTRACT_API_URL', 'http://localhost:3000');
    expect(contractTestConfig()).toEqual({ apiUrl: 'http://localhost:3000' });
  });
});

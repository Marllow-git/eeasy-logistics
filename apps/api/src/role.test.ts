import { describe, expect, it } from 'vitest';
import { parseRole } from './role.js';

describe('parseRole', () => {
  it('defaults to api', () => {
    expect(parseRole([])).toBe('api');
  });

  it('reads --role worker and --role=worker', () => {
    expect(parseRole(['--role', 'worker'])).toBe('worker');
    expect(parseRole(['--role=worker'])).toBe('worker');
    expect(parseRole(['--role', 'api'])).toBe('api');
  });

  it('rejects an unknown or missing role value', () => {
    expect(() => parseRole(['--role', 'scheduler'])).toThrow('Invalid --role "scheduler"');
    expect(() => parseRole(['--role'])).toThrow('Invalid --role ""');
  });
});

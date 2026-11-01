import { publicConfig } from '@eeasy-logistics/config/driver';

// Wiring check: the jest-expo transform compiles the workspace config package (TypeScript source with
// `.ts` imports, and zod) and the driver's publicConfig() runs. babel-preset-expo inlines the
// EXPO_PUBLIC_* values when it transforms the file, from the environment Jest was started with, so
// the result depends on that environment: either a validated config, or a ConfigError that names
// only EXPO_PUBLIC_* variables. The value-level cases are the package's own tests. (The driver does
// not import the package root: it is server code and needs Node types.)
describe('publicConfig in the driver app', () => {
  it('validates the EXPO_PUBLIC_* values', () => {
    let result: unknown;
    try {
      result = publicConfig();
    } catch (error) {
      expect(error).toHaveProperty('name', 'ConfigError');
      const issues = (error as { issues: { variable: string }[] }).issues;
      expect(issues.length).toBeGreaterThan(0);
      for (const issue of issues) expect(issue.variable).toMatch(/^EXPO_PUBLIC_/);
      return;
    }
    expect(result).toHaveProperty('apiUrl');
    expect(Object.isFrozen(result)).toBe(true);
  });
});

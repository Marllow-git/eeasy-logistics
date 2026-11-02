import { describe, expect, it } from 'vitest';
import { ConfigError, defineConfig } from '../src/index.ts';

// DEL-4 plan 2.14: the driver app invitation link and the minimum app versions per platform.

function problems(env: Record<string, string>): Record<string, string> {
  try {
    defineConfig(env);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    return Object.fromEntries(error.issues.map((issue) => [issue.variable, issue.problem]));
  }
  return {};
}

describe('driver configuration (DEL-4 plan 2.14)', () => {
  it('defaults the invitation link to the store landing and sets no minimum version', () => {
    expect(defineConfig({ APP_ENV: 'local' }).drivers).toEqual({
      appUrl: 'https://eeasy.sa/driver',
      minAppVersion: { ios: undefined, android: undefined },
    });
  });

  it('reads the link and a minimum version per platform', () => {
    const config = defineConfig({
      APP_ENV: 'local',
      DRIVER_APP_URL: 'https://apps.example.test/eeasy-driver',
      DRIVER_MIN_APP_VERSION_IOS: '1.4.0',
      DRIVER_MIN_APP_VERSION_ANDROID: '10.0.12',
    });
    expect(config.drivers).toEqual({
      appUrl: 'https://apps.example.test/eeasy-driver',
      minAppVersion: { ios: '1.4.0', android: '10.0.12' },
    });
  });

  it('refuses a link that is not http(s) and a version that is not major.minor.patch', () => {
    expect(problems({ APP_ENV: 'local', DRIVER_APP_URL: 'ftp://eeasy.sa/driver' })).toHaveProperty(
      'DRIVER_APP_URL',
    );
    for (const version of ['1.4', '1.4.0-beta', 'v1.4.0', '1.4.0.1', ' 1.4.0', '1234567890.0.0']) {
      expect(problems({ APP_ENV: 'local', DRIVER_MIN_APP_VERSION_IOS: version })).toHaveProperty(
        'DRIVER_MIN_APP_VERSION_IOS',
      );
    }
    expect(problems({ APP_ENV: 'local', DRIVER_MIN_APP_VERSION_ANDROID: '2' })).toHaveProperty(
      'DRIVER_MIN_APP_VERSION_ANDROID',
    );
  });
});

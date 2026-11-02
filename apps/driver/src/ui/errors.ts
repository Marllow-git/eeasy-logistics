import { ApiError } from '@eeasy-logistics/contracts/http';
import { t } from '../i18n';
import { retryAfterSeconds } from '../sync/sign-in';

/** The generic message for a failed call: offline, rate limited, messaging down, or unexpected. */
export function genericErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return t('errors.network');
  if (error.code === 'rate_limited') {
    return t('errors.rate_limited', { seconds: retryAfterSeconds(error) ?? 60 });
  }
  if (error.code === 'messaging_unavailable') return t('errors.messaging_unavailable');
  return t('errors.unexpected');
}

/** The refusals of `driverVerifyOtp` (driver.yaml; DEL-4 plan 8.2 #26, #39) in the driver's words. */
export function verifyErrorMessage(error: unknown): { message: string; codeWrong: boolean } {
  if (error instanceof ApiError) {
    if (error.code === 'otp_invalid') return { message: t('verify.otp_invalid'), codeWrong: true };
    if (error.code === 'device_limit_reached') {
      return { message: t('verify.device_limit'), codeWrong: false };
    }
    if (error.code === 'device_revoked') {
      return { message: t('verify.device_revoked'), codeWrong: false };
    }
  }
  return { message: genericErrorMessage(error), codeWrong: false };
}

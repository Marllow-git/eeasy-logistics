/** `DRIVER_APP_URL` (DEL-4 plan 2.3, 2.14): the link of the driver's WhatsApp app invitation. */
export const DRIVER_APP_URL = Symbol('DRIVER_APP_URL');

/**
 * `DRIVER_MIN_APP_VERSION_IOS` and `_ANDROID` (DEL-4 plan 2.10, 2.14): the lowest driver app version
 * per platform, `{ ios?, android? }`; absent means no minimum.
 */
export const DRIVER_MIN_APP_VERSION = Symbol('DRIVER_MIN_APP_VERSION');

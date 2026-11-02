import type { ConfigContext, ExpoConfig } from 'expo/config';
import ar from '../../packages/i18n/ar/driver.json';
import en from '../../packages/i18n/en/driver.json';

// The native permission strings (driver app §6.3, DRV-1 plan 2.7) come from the `driver` catalogue,
// so they exist in both languages like every other string: English as the base Info.plist value,
// Arabic and English as localised InfoPlist.strings. app.json holds the rest of the config.
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: config.name ?? 'Eeasy Logistics Driver',
  slug: config.slug ?? 'eeasy-logistics-driver',
  plugins: [
    ...(config.plugins ?? []),
    [
      'expo-location',
      {
        locationWhenInUsePermission: en.native.location_when_in_use,
        locationAlwaysAndWhenInUsePermission: en.native.location_always,
        isIosBackgroundLocationEnabled: true,
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
    ['expo-camera', { cameraPermission: en.native.camera, recordAudioAndroid: false }],
  ],
  locales: {
    ar: {
      NSLocationWhenInUseUsageDescription: ar.native.location_when_in_use,
      NSLocationAlwaysAndWhenInUseUsageDescription: ar.native.location_always,
      NSCameraUsageDescription: ar.native.camera,
    },
    en: {
      NSLocationWhenInUseUsageDescription: en.native.location_when_in_use,
      NSLocationAlwaysAndWhenInUseUsageDescription: en.native.location_always,
      NSCameraUsageDescription: en.native.camera,
    },
  },
});

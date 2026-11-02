import { publicConfig } from '@eeasy-logistics/config/driver';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { AppState, View } from 'react-native';
import { appLocale, applyDirection, reloadForDirection, t } from '../src/i18n';
import { appRelease, startObservability } from '../src/observability';
import { initDriverApp } from '../src/sync/driver-app';
import { Banner, Button, Loading } from '../src/ui/kit';
import { space } from '../src/ui/tokens';
import { registerPushToken, watchPushToken } from '../src/sync/push-token';
import { useGate, useSessionState, useSetupState } from '../src/ui/use-driver';

// Root navigator (driver app §9, DRV-1 plan 2.1): the stored language sets the direction before the
// first frame (a mismatch reloads once), the sync layer is built once and reads the stored session,
// and the gate decides which group exists: `(auth)` without a session, `(setup)` until the PIN and
// permissions steps are done, `(app)` otherwise, `update` when the API refuses this build.

const needsReload = applyDirection();
const config = publicConfig();
startObservability({
  sentryDsn: config.sentryDsn,
  posthogKey: config.posthogKey,
  release: appRelease(),
  environment: config.appEnv,
});
const app = initDriverApp(appLocale);

export default function RootLayout() {
  useEffect(() => {
    if (needsReload) {
      void reloadForDirection();
      return;
    }
    void app.start();
  }, []);

  const gate = useGate();
  const { softUpdate } = useSetupState();
  const [softDismissed, setSoftDismissed] = useState(false);
  const { signedIn } = useSessionState();

  // The push token follows a granted permission and Expo's rotations while signed in (plan 2.7).
  useEffect(() => {
    if (!signedIn) return;
    void registerPushToken();
    const unwatch = watchPushToken();
    // Each foreground re-reads `driverGetMe`: min_app_version, the PIN state (plan 2.9).
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void app.loadMe();
    });
    return () => {
      unwatch();
      subscription.remove();
    };
  }, [signedIn]);

  if (needsReload || gate === 'loading') return <Loading label={t('common.loading')} />;

  return (
    <View style={{ flex: 1 }}>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={gate === 'update'}>
          <Stack.Screen name="update" />
        </Stack.Protected>
        <Stack.Protected guard={gate === 'auth'}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={gate === 'setup-pin' || gate === 'setup-permissions'}>
          <Stack.Screen name="(setup)" />
        </Stack.Protected>
        <Stack.Protected guard={gate === 'app'}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
      </Stack>
      {gate === 'app' && softUpdate && !softDismissed ? (
        <View
          style={{
            position: 'absolute',
            bottom: space.xl,
            start: space.lg,
            end: space.lg,
            gap: space.sm,
          }}
        >
          <Banner tone="warning" testID="soft-update-notice">
            {t('update.soft_body')}
          </Banner>
          <Button
            variant="secondary"
            label={t('update.dismiss')}
            onPress={() => setSoftDismissed(true)}
          />
        </View>
      ) : null}
    </View>
  );
}

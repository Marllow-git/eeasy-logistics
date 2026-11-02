import { useEffect, useState } from 'react';
import { AppState, View } from 'react-native';
import { t, type DriverKey } from '../../src/i18n';
import {
  openSystemSettings,
  permissionState,
  requestPermission,
  type PermissionName,
  type PermissionState,
} from '../../src/platform/permissions';
import { driverApp } from '../../src/sync/driver-app';
import { registerPushToken } from '../../src/sync/push-token';
import { Banner, Body, Button, Screen, Small, Title } from '../../src/ui/kit';
import { colors, radius, space } from '../../src/ui/tokens';

// The permissions step (driver app §6.3, DRV-1 plan 2.7): each permission with its purpose, an
// "allow" that shows the OS prompt (or the system settings once the OS stops asking), and a way on
// without deciding. Background location waits for the foreground grant; refusing it is allowed with
// the warning of §13 #4. The choices stay in the OS; only "the step was left" is kept.

const order: readonly PermissionName[] = ['location', 'background', 'notifications', 'camera'];

const copy: Record<PermissionName, { title: DriverKey; body: DriverKey }> = {
  location: { title: 'permissions.location_title', body: 'permissions.location_body' },
  background: { title: 'permissions.background_title', body: 'permissions.background_body' },
  notifications: {
    title: 'permissions.notifications_title',
    body: 'permissions.notifications_body',
  },
  camera: { title: 'permissions.camera_title', body: 'permissions.camera_body' },
};

async function readAll(): Promise<Partial<Record<PermissionName, PermissionState>>> {
  const entries = await Promise.all(
    order.map(async (name) => [name, await permissionState(name)] as const),
  );
  return Object.fromEntries(entries);
}

export default function PermissionsScreen() {
  const [states, setStates] = useState<Partial<Record<PermissionName, PermissionState>>>({});

  useEffect(() => {
    void readAll().then(setStates);
    // Coming back from the system settings re-reads the answers.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void readAll().then(setStates);
    });
    return () => subscription.remove();
  }, []);

  const allow = async (name: PermissionName) => {
    const current = states[name];
    if (current !== undefined && current.status === 'denied' && !current.canAskAgain) {
      await openSystemSettings();
      return;
    }
    const next = await requestPermission(name);
    setStates((previous) => ({ ...previous, [name]: next }));
    if (name === 'notifications' && next.status === 'granted') void registerPushToken();
  };

  const foregroundGranted = states.location?.status === 'granted';
  const backgroundRefused =
    states.background !== undefined && states.background.status !== 'granted';

  return (
    <Screen
      footer={
        <Button
          testID="permissions-continue"
          label={t('permissions.done')}
          onPress={() => driverApp().setPermissionsDone()}
        />
      }
    >
      <Title>{t('permissions.title')}</Title>
      <Body tone="muted">{t('permissions.intro')}</Body>
      {order.map((name) => {
        const state = states[name];
        const blocked = name === 'background' && !foregroundGranted;
        return (
          <View
            key={name}
            testID={`permission-${name}`}
            style={{
              gap: space.sm,
              padding: space.lg,
              borderRadius: radius.lg,
              borderCurve: 'continuous',
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.surface,
            }}
          >
            <Body>{t(copy[name].title)}</Body>
            <Small>{t(copy[name].body)}</Small>
            {state?.status === 'granted' ? (
              <Small>{t('permissions.granted')}</Small>
            ) : (
              <>
                {state?.status === 'denied' ? <Small>{t('permissions.denied')}</Small> : null}
                <Button
                  testID={`allow-${name}`}
                  variant="secondary"
                  label={
                    state?.status === 'denied' && !state.canAskAgain
                      ? t('permissions.open_settings')
                      : t('permissions.allow')
                  }
                  disabled={blocked}
                  onPress={() => void allow(name)}
                />
              </>
            )}
          </View>
        );
      })}
      {backgroundRefused ? (
        <Banner tone="warning" testID="background-warning">
          {t('permissions.background_warning')}
        </Banner>
      ) : null}
    </Screen>
  );
}

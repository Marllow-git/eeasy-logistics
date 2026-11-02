import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { composePhone, isPlausiblePhone, saudiPrefix } from '../../src/domain/phone';
import { appLocale, t } from '../../src/i18n';
import { requestOtp } from '../../src/sync/sign-in';
import { genericErrorMessage } from '../../src/ui/errors';
import { Banner, Body, Button, Screen, TextField, Title } from '../../src/ui/kit';
import { LanguageSwitch } from '../../src/ui/language-switch';
import { colors, radius, space, text, touchTarget } from '../../src/ui/tokens';
import { useSessionState } from '../../src/ui/use-driver';

/** Phone entry (driver app §7.1, DRV-1 plan 2.5): the +966 prefix offered, a generic answer. */
export default function SignInScreen() {
  const router = useRouter();
  const { endReason } = useSessionState();
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const send = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const composed = composePhone(phone);
      await requestOtp(composed, appLocale());
      router.push({ pathname: '/verify', params: { phone: composed } });
    } catch (caught) {
      setError(genericErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      footer={
        <Button
          testID="send-code"
          label={t('sign_in.send')}
          disabled={!isPlausiblePhone(phone)}
          busy={busy}
          onPress={() => void send()}
        />
      }
    >
      <View style={{ alignItems: 'flex-end' }}>
        <LanguageSwitch />
      </View>
      <Title>{t('sign_in.title')}</Title>
      <Body tone="muted">{t('sign_in.subtitle')}</Body>
      {endReason === 'device_revoked' ? (
        <Banner tone="danger" testID="device-revoked-notice">
          {t('verify.device_revoked')}
        </Banner>
      ) : null}
      {/* A phone number reads left to right in both languages: prefix, then the number. */}
      <View style={{ flexDirection: 'row', direction: 'ltr', gap: space.sm }}>
        <View
          accessibilityLabel={`${t('sign_in.prefix_label')} ${saudiPrefix}`}
          style={{
            minHeight: touchTarget,
            paddingHorizontal: space.lg,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colors.input,
            backgroundColor: colors.muted,
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: text.body.fontSize, color: colors.foreground }}>
            {saudiPrefix}
          </Text>
        </View>
        <TextField
          testID="phone-input"
          label={t('sign_in.phone_label')}
          placeholder={t('sign_in.phone_placeholder')}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          autoComplete="tel"
          autoFocus
          style={{ flex: 1, textAlign: 'left', writingDirection: 'ltr' }}
          onSubmitEditing={() => {
            if (isPlausiblePhone(phone)) void send();
          }}
        />
      </View>
      {error === undefined ? null : (
        <Banner tone="danger" testID="sign-in-error">
          {error}
        </Banner>
      )}
    </Screen>
  );
}

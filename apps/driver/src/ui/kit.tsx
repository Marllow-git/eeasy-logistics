import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  I18nManager,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type TextStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radius, space, text, touchTarget } from './tokens';

// The driver kit's base components (DRV-1 plan 2.2): built for right to left first. Layout uses
// start and end (React Native mirrors them under I18nManager.forceRTL); text takes the line height
// of its script; every pressable is at least 56 dp high.

const rtl = (): boolean => I18nManager.isRTL;

function textStyle(kind: keyof typeof text, color: string = colors.foreground): TextStyle {
  const spec = text[kind];
  return {
    fontSize: spec.fontSize,
    lineHeight: rtl() ? spec.lineHeightAr : spec.lineHeightEn,
    fontWeight: spec.fontWeight,
    color,
    textAlign: 'left',
    writingDirection: rtl() ? 'rtl' : 'ltr',
  };
}

export function Screen({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ flexGrow: 1, padding: space.xl, gap: space.lg }}
      >
        {children}
      </ScrollView>
      {footer === undefined ? null : (
        <View style={{ paddingHorizontal: space.xl, paddingBottom: space.lg, gap: space.md }}>
          {footer}
        </View>
      )}
    </SafeAreaView>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" style={textStyle('title')}>
      {children}
    </Text>
  );
}

export function Body({
  children,
  tone = 'default',
  testID,
}: {
  children: ReactNode;
  tone?: 'default' | 'muted';
  testID?: string;
}) {
  return (
    <Text
      testID={testID}
      selectable
      style={textStyle('body', tone === 'muted' ? colors.mutedForeground : colors.foreground)}
    >
      {children}
    </Text>
  );
}

export function Small({ children }: { children: ReactNode }) {
  return <Text style={textStyle('small', colors.mutedForeground)}>{children}</Text>;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  busy = false,
  testID,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'link';
  disabled?: boolean;
  busy?: boolean;
  testID?: string;
  accessibilityHint?: string;
}) {
  const inactive = disabled || busy;
  const background =
    variant === 'primary' ? (inactive ? colors.input : colors.primary) : colors.background;
  const foreground = variant === 'primary' ? colors.primaryForeground : colors.primary;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: touchTarget,
        borderRadius: radius.md,
        borderCurve: 'continuous',
        borderWidth: variant === 'secondary' ? 1 : 0,
        borderColor: colors.primary,
        backgroundColor: pressed && variant === 'primary' ? colors.primaryPressed : background,
        opacity: pressed && variant !== 'primary' ? 0.7 : 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: space.lg,
      })}
    >
      {busy ? (
        <ActivityIndicator color={foreground} />
      ) : (
        <Text style={{ ...textStyle('body', foreground), fontWeight: '600', textAlign: 'center' }}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function TextField({
  label,
  error,
  style,
  ...input
}: TextInputProps & { label: string; error?: boolean }) {
  return (
    <TextInput
      accessibilityLabel={label}
      placeholderTextColor={colors.mutedForeground}
      {...input}
      style={[
        {
          minHeight: touchTarget,
          borderWidth: error ? 2 : 1,
          borderColor: error ? colors.danger : colors.input,
          borderRadius: radius.md,
          paddingHorizontal: space.lg,
          fontSize: text.body.fontSize,
          color: colors.foreground,
          backgroundColor: colors.background,
        },
        style,
      ]}
    />
  );
}

export function Banner({
  tone,
  children,
  testID,
}: {
  tone: 'info' | 'success' | 'warning' | 'danger';
  children: ReactNode;
  testID?: string;
}) {
  const palette = {
    info: { background: colors.muted, border: colors.input, color: colors.foreground },
    success: { background: '#ecfdf3', border: colors.success, color: colors.success },
    warning: { background: '#fffaeb', border: colors.warning, color: colors.warning },
    danger: { background: '#fef3f2', border: colors.danger, color: colors.danger },
  }[tone];
  return (
    <View
      testID={testID}
      accessibilityRole={tone === 'danger' ? 'alert' : 'summary'}
      accessibilityLiveRegion="polite"
      style={{
        backgroundColor: palette.background,
        borderColor: palette.border,
        borderWidth: 1,
        borderStartWidth: 4,
        borderRadius: radius.md,
        padding: space.md,
      }}
    >
      <Text selectable style={textStyle('small', palette.color)}>
        {children}
      </Text>
    </View>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <View
      accessibilityLabel={label}
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
    >
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

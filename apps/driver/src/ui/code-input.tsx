import { Text, TextInput, View } from 'react-native';
import { westernDigits } from '../domain/phone';
import { colors, radius, space } from './tokens';

/**
 * Six boxes over one input (DRV-1 plan 2.5): Western digits only, the boxes left to right in both
 * languages (a code is not mirrored), iOS one-time-code autofill. The boxes show the digits typed.
 */
export function CodeInput({
  value,
  onChange,
  label,
  error = false,
  length = 6,
  testID,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  error?: boolean;
  length?: number;
  testID?: string;
}) {
  const digits = Array.from({ length }, (_, index) => value[index] ?? '');
  return (
    <View testID={testID} style={{ direction: 'ltr' }}>
      <View style={{ flexDirection: 'row', gap: space.sm, justifyContent: 'center' }}>
        {digits.map((digit, index) => (
          <View
            key={index}
            style={{
              width: 48,
              height: 56,
              borderRadius: radius.md,
              borderWidth: index === value.length || error ? 2 : 1,
              borderColor: error
                ? colors.danger
                : index === value.length
                  ? colors.primary
                  : colors.input,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 24, fontWeight: '600', color: colors.foreground }}>
              {digit}
            </Text>
          </View>
        ))}
      </View>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={(next) => onChange(westernDigits(next).replace(/\D/g, '').slice(0, length))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={length}
        autoFocus
        caretHidden
        // Not 0: UIKit skips views under 0.01 alpha when hit testing, so a tap would miss it.
        style={{ position: 'absolute', inset: 0, opacity: 0.02, color: 'transparent', fontSize: 1 }}
      />
    </View>
  );
}

import { Pressable, Text, View } from 'react-native';
import { t } from '../i18n';
import { colors, radius, space, touchTarget } from './tokens';

// The PIN keypad (driver app §5.2, DRV-1 plan 2.6): Western digits, no digit ever shown (dots only),
// the phone-keypad order in both languages (a keypad is not mirrored). The PIN stays in the parent's
// state and leaves only into a request body.

const rows = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['', '0', 'delete'],
] as const;

export function PinDots({ count, max }: { count: number; max: number }) {
  return (
    <View
      accessible
      accessibilityLabel={t('pin.entered', { count })}
      style={{ flexDirection: 'row', direction: 'ltr', justifyContent: 'center', gap: space.md }}
    >
      {Array.from({ length: max }, (_, index) => (
        <View
          key={index}
          style={{
            width: 16,
            height: 16,
            borderRadius: radius.full,
            borderWidth: 2,
            borderColor: colors.primary,
            backgroundColor: index < count ? colors.primary : 'transparent',
          }}
        />
      ))}
    </View>
  );
}

export function Keypad({
  value,
  onChange,
  maxLength,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  disabled?: boolean;
}) {
  return (
    <View style={{ direction: 'ltr', gap: space.sm }}>
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} style={{ flexDirection: 'row', gap: space.sm }}>
          {row.map((key, keyIndex) =>
            key === '' ? (
              <View key={keyIndex} style={{ flex: 1 }} />
            ) : (
              <Pressable
                key={keyIndex}
                testID={key === 'delete' ? 'pin-key-delete' : `pin-key-${key}`}
                accessibilityRole="button"
                accessibilityLabel={key === 'delete' ? t('pin.delete') : key}
                disabled={disabled}
                onPress={() => {
                  if (key === 'delete') onChange(value.slice(0, -1));
                  else if (value.length < maxLength) onChange(value + key);
                }}
                style={({ pressed }) => ({
                  flex: 1,
                  minHeight: touchTarget + 8,
                  borderRadius: radius.md,
                  borderCurve: 'continuous',
                  backgroundColor: pressed ? colors.border : colors.muted,
                  alignItems: 'center',
                  justifyContent: 'center',
                })}
              >
                <Text style={{ fontSize: key === 'delete' ? 22 : 28, color: colors.foreground }}>
                  {key === 'delete' ? '⌫' : key}
                </Text>
              </Pressable>
            ),
          )}
        </View>
      ))}
    </View>
  );
}

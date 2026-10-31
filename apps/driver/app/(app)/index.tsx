import { defaultLocale, dir, t } from '@eeasy-logistics/i18n';
import { StyleSheet, Text, View } from 'react-native';

// Arabic is the default on first launch (driver app §10); the language setting arrives with DRV work.
const locale = defaultLocale;

export default function PlaceholderScreen() {
  const textStyle = { writingDirection: dir(locale) } as const;
  return (
    <View style={styles.container}>
      <Text style={[styles.title, textStyle]}>{t(locale, 'app.name')}</Text>
      <Text style={textStyle}>{t(locale, 'placeholder.driver')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 24, fontWeight: '600' },
});

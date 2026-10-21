import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { Language } from '@/lib/progress';

const OPTIONS: { lang: Language; label: string }[] = [
  { lang: 'zh', label: '中文' },
  { lang: 'fr', label: 'Français' },
];

export function LanguageSwitcher({ language, onChange }: { language: Language; onChange: (lang: Language) => void }) {
  return (
    <ThemedView style={styles.row}>
      {OPTIONS.map((opt) => (
        <Pressable key={opt.lang} onPress={() => onChange(opt.lang)}>
          <ThemedView type={language === opt.lang ? 'backgroundSelected' : 'backgroundElement'} style={styles.pill}>
            <ThemedText type="smallBold">{opt.label}</ThemedText>
          </ThemedView>
        </Pressable>
      ))}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  pill: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
});

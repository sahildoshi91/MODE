import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { FloatingQuickActionChip } from '../../../../lib/components/glass';
import { theme } from '../../../../lib/theme';

export default function SuggestedActionChips({
  actions = [],
  disabled = false,
  onSelect,
  testID = 'suggested-action-chips',
}) {
  const visibleActions = (actions || []).filter(Boolean).slice(0, 5);
  if (!visibleActions.length) {
    return null;
  }

  return (
    <View testID={testID} style={styles.wrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        style={styles.scroll}
        contentContainerStyle={styles.content}
      >
        {visibleActions.map((action) => (
          <FloatingQuickActionChip
            key={action}
            label={action}
            disabled={disabled}
            onPress={disabled ? undefined : () => onSelect?.(action)}
            style={styles.chip}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
  },
  scroll: {
    width: '100%',
    marginTop: theme.spacing[1],
  },
  content: {
    paddingHorizontal: theme.spacing[1],
    paddingVertical: theme.spacing[1],
    gap: theme.spacing[1],
  },
  chip: {
    marginRight: theme.spacing[1],
    minHeight: 32,
  },
});

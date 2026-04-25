import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ModeText } from '../../../../../lib/components';
import { theme } from '../../../../../lib/theme';

const DAYS = [
  { key: 1, short: 'M', label: 'Monday' },
  { key: 2, short: 'T', label: 'Tuesday' },
  { key: 3, short: 'W', label: 'Wednesday' },
  { key: 4, short: 'T', label: 'Thursday' },
  { key: 5, short: 'F', label: 'Friday' },
  { key: 6, short: 'S', label: 'Saturday' },
  { key: 7, short: 'S', label: 'Sunday' },
];

export default function ScheduleDayToggleRow({
  selectedDays = [],
  onToggle,
  testIDPrefix = 'client-context-day-toggle',
}) {
  const normalized = Array.isArray(selectedDays) ? selectedDays : [];

  return (
    <View style={styles.row}>
      {DAYS.map((day) => {
        const selected = normalized.includes(day.key);
        return (
          <Pressable
            key={day.key}
            testID={`${testIDPrefix}-${day.key}`}
            accessibilityRole="button"
            accessibilityLabel={day.label}
            accessibilityState={{ selected }}
            onPress={() => onToggle?.(day.key)}
            style={({ pressed }) => [
              styles.dayButton,
              selected && styles.dayButtonSelected,
              pressed && styles.dayButtonPressed,
            ]}
          >
            <ModeText
              variant="caption"
              tone={selected ? 'primary' : 'secondary'}
              style={styles.dayLabel}
            >
              {day.short}
            </ModeText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dayButton: {
    flex: 1,
    minHeight: 38,
    borderRadius: theme.radii.m,
    borderWidth: 1,
    borderColor: theme.colors.glass.borderSoft,
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayButtonSelected: {
    borderColor: theme.colors.nav.activeBorder,
    backgroundColor: theme.colors.nav.activeBg,
  },
  dayButtonPressed: {
    opacity: theme.interaction.pressedOpacity,
  },
  dayLabel: {
    fontWeight: '700',
  },
});

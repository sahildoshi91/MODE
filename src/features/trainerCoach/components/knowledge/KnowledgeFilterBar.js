import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';

import { ModeText } from '../../../../../lib/components';
import { theme } from '../../../../../lib/theme';

const SCOPE_OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'global', label: 'Global' },
  { key: 'client', label: 'Client' },
];

function MicroFilterChip({
  label,
  selected = false,
  onPress,
  testID,
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [
        styles.microChip,
        selected && styles.microChipSelected,
        pressed && styles.microChipPressed,
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <ModeText variant="caption" tone={selected ? 'primary' : 'secondary'}>{label}</ModeText>
    </Pressable>
  );
}

export default function KnowledgeFilterBar({
  scopeFilter = 'all',
  aiEnabledOnly = false,
  includeArchived = false,
  onChangeScopeFilter,
  onToggleAiEnabledOnly,
  onToggleIncludeArchived,
}) {
  const [isFilterTrayOpen, setIsFilterTrayOpen] = useState(false);
  const activeFilters = useMemo(() => (
    [
      aiEnabledOnly ? 'AI' : null,
      includeArchived ? 'Archived' : null,
    ].filter(Boolean)
  ), [aiEnabledOnly, includeArchived]);

  return (
    <View style={styles.wrap}>
      <View style={styles.primaryRow}>
        <View style={styles.segmentedWrap}>
          {SCOPE_OPTIONS.map((option) => {
            const selected = scopeFilter === option.key;
            return (
              <Pressable
                key={option.key}
                testID={`trainer-coach-knowledge-filter-scope-${option.key}`}
                onPress={() => onChangeScopeFilter?.(option.key)}
                style={({ pressed }) => [
                  styles.segmentButton,
                  selected && styles.segmentButtonActive,
                  pressed && styles.segmentButtonPressed,
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected }}
              >
                <ModeText variant="caption" tone={selected ? 'primary' : 'secondary'}>{option.label}</ModeText>
              </Pressable>
            );
          })}
        </View>
        <Pressable
          testID="trainer-coach-knowledge-filter-menu"
          onPress={() => setIsFilterTrayOpen((current) => !current)}
          style={({ pressed }) => [
            styles.filterButton,
            activeFilters.length > 0 && styles.filterButtonActive,
            pressed && styles.filterButtonPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Filter coaching knowledge"
        >
          <Feather name="sliders" size={15} color={theme.colors.text.secondary} />
          {activeFilters.length > 0 ? (
            <View style={styles.filterBadge}>
              <ModeText variant="caption" tone="primary">{activeFilters.length}</ModeText>
            </View>
          ) : null}
        </Pressable>
      </View>
      {activeFilters.length > 0 ? (
        <View style={styles.activeBadgeRow}>
          {activeFilters.map((filter) => (
            <View key={filter} style={styles.activeBadge}>
              <ModeText variant="caption" tone="primary">{filter}</ModeText>
            </View>
          ))}
        </View>
      ) : null}
      {isFilterTrayOpen ? (
        <View style={styles.trayRow}>
          <MicroFilterChip
            label="AI usable"
            selected={aiEnabledOnly}
            onPress={onToggleAiEnabledOnly}
            testID="trainer-coach-knowledge-filter-ai-enabled"
          />
          <MicroFilterChip
            label="Archived"
            selected={includeArchived}
            onPress={onToggleIncludeArchived}
            testID="trainer-coach-knowledge-filter-archived"
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 6,
  },
  primaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[1],
  },
  segmentedWrap: {
    flex: 1,
    minHeight: 34,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(118, 150, 210, 0.22)',
    backgroundColor: 'rgba(8, 17, 31, 0.72)',
    flexDirection: 'row',
    padding: 2,
    gap: 2,
  },
  segmentButton: {
    flex: 1,
    minHeight: 30,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  segmentButtonActive: {
    borderWidth: 1,
    borderColor: 'rgba(124, 167, 234, 0.5)',
    backgroundColor: 'rgba(39, 72, 123, 0.48)',
  },
  segmentButtonPressed: {
    opacity: 0.86,
  },
  filterButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(118, 150, 210, 0.3)',
    backgroundColor: 'rgba(12, 21, 40, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterButtonActive: {
    borderColor: 'rgba(128, 174, 244, 0.56)',
  },
  filterButtonPressed: {
    opacity: 0.82,
  },
  filterBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(123, 168, 237, 0.56)',
    backgroundColor: 'rgba(42, 71, 117, 0.95)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  activeBadge: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(120, 165, 238, 0.36)',
    backgroundColor: 'rgba(33, 57, 97, 0.4)',
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  trayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  microChip: {
    minHeight: 28,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(103, 136, 194, 0.34)',
    backgroundColor: 'rgba(10, 19, 36, 0.54)',
    paddingHorizontal: 10,
    justifyContent: 'center',
  },
  microChipSelected: {
    borderColor: 'rgba(124, 167, 234, 0.54)',
    backgroundColor: 'rgba(35, 65, 108, 0.44)',
  },
  microChipPressed: {
    opacity: 0.82,
  },
});

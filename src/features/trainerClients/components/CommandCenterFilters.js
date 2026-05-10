import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import Feather from '@expo/vector-icons/Feather';

import {
  GlassSurface,
  ModeText,
} from '../../../../lib/components';
import { theme } from '../../../../lib/theme';

export function FilterPill({
  label,
  value,
  emphasized = false,
  onPress,
  testID,
}) {
  const chevronColor = emphasized ? theme.colors.text.primary : theme.colors.text.secondary;

  return (
    <GlassSurface
      testID={testID}
      state={emphasized ? 'active' : 'default'}
      radius="pill"
      padding={0}
      onPress={onPress}
      accessibilityLabel={`${label}: ${value}`}
      style={[styles.filterPill, emphasized && styles.filterPillActive]}
      contentStyle={styles.filterPillContent}
      fillColor={emphasized ? theme.colors.nav.activeBg : theme.colors.glass.base}
      borderColor={emphasized ? theme.colors.nav.activeBorder : theme.colors.glass.borderSoft}
      highlight
    >
      <View style={styles.filterPillRow}>
        <ModeText
          testID={testID ? `${testID}-value` : undefined}
          variant="bodySm"
          tone={emphasized ? 'primary' : 'secondary'}
          style={styles.filterPillValue}
          numberOfLines={1}
        >
          {value}
        </ModeText>
        <Feather name="chevron-down" size={14} color={chevronColor} />
      </View>
    </GlassSurface>
  );
}

export function FilterBar({
  dayLabel,
  sessionLabel,
  priorityLabel,
  onPressDay,
  onPressSession,
  onPressPriority,
  isDayCustom = false,
  isSessionCustom = false,
  isPriorityCustom = false,
}) {
  return (
    <View testID="trainer-clients-filter-bar" style={styles.filterBarWrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterBarContent}
      >
        <FilterPill
          testID="trainer-clients-filter-pill-day"
          label="Day Window"
          value={dayLabel}
          emphasized={isDayCustom}
          onPress={onPressDay}
        />
        <FilterPill
          testID="trainer-clients-filter-pill-session"
          label="Session Scope"
          value={sessionLabel}
          emphasized={isSessionCustom}
          onPress={onPressSession}
        />
        <FilterPill
          testID="trainer-clients-filter-pill-priority"
          label="Priority"
          value={priorityLabel}
          emphasized={isPriorityCustom}
          onPress={onPressPriority}
        />
      </ScrollView>
    </View>
  );
}

export function FilterBottomSheet({
  visible,
  title,
  options,
  selectedKey,
  onSelect,
  onClose,
  showReset = false,
  onReset,
  bottomInset = 0,
}) {
  if (!visible) {
    return null;
  }

  const sheetBottomPadding = Math.max(theme.spacing[2], bottomInset + theme.spacing[2]);

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View testID="trainer-clients-filter-sheet" style={styles.modalRoot}>
        <Pressable
          testID="trainer-clients-filter-sheet-backdrop"
          style={styles.backdrop}
          onPress={onClose}
        />

        <GlassSurface
          state="elevated"
          radius="xl"
          padding={0}
          style={styles.sheet}
          contentStyle={[styles.sheetContent, { paddingBottom: sheetBottomPadding }]}
          fillColor={theme.colors.surface.overlay}
          borderColor={theme.colors.glass.borderStrong}
          highlight
        >
          <View style={styles.sheetGrabber} />

          <View style={styles.sheetHeader}>
            <ModeText testID="trainer-clients-filter-sheet-title" variant="h3" style={styles.sheetTitle}>
              {title}
            </ModeText>
            <Pressable
              testID="trainer-clients-filter-sheet-close"
              style={({ pressed }) => [styles.closeButton, pressed && styles.closeButtonPressed]}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close filter selector"
            >
              <Feather name="x" size={18} color={theme.colors.text.secondary} />
            </Pressable>
          </View>

          <View style={styles.optionList}>
            {options.map((option) => {
              const selected = option.key === selectedKey;
              return (
                <GlassSurface
                  key={option.key}
                  testID={`trainer-clients-filter-sheet-option-${option.key}`}
                  state={selected ? 'active' : 'default'}
                  radius="m"
                  padding={0}
                  onPress={() => onSelect?.(option.key)}
                  style={[styles.optionItem, selected && styles.optionItemSelected]}
                  contentStyle={styles.optionItemContent}
                  fillColor={selected ? theme.colors.nav.activeBg : theme.colors.glass.elevated}
                  borderColor={selected ? theme.colors.nav.activeBorder : theme.colors.glass.borderSoft}
                >
                  <View style={styles.optionItemRow}>
                    <ModeText variant="bodySm" tone={selected ? 'primary' : 'secondary'} style={styles.optionLabel}>
                      {option.label}
                    </ModeText>
                    {selected ? (
                      <Feather name="check" size={16} color={theme.colors.text.primary} />
                    ) : (
                      <Feather name="circle" size={14} color={theme.colors.text.muted} />
                    )}
                  </View>
                </GlassSurface>
              );
            })}
          </View>

          {showReset && typeof onReset === 'function' ? (
            <Pressable
              testID="trainer-clients-filter-sheet-reset"
              style={({ pressed }) => [styles.resetAction, pressed && styles.resetActionPressed]}
              onPress={onReset}
              accessibilityRole="button"
              accessibilityLabel="Reset filters"
            >
              <ModeText variant="caption" tone="secondary" style={styles.resetActionLabel}>Reset filters</ModeText>
            </Pressable>
          ) : null}
        </GlassSurface>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  filterBarWrap: {
    marginTop: theme.spacing[1] - 2,
    marginBottom: theme.spacing[1],
  },
  filterBarContent: {
    gap: theme.spacing[1],
    paddingRight: theme.spacing[1],
  },
  filterPill: {
    minHeight: 34,
    minWidth: 92,
  },
  filterPillActive: {
    shadowColor: theme.colors.accent.primary,
    shadowOpacity: 0.13,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  filterPillContent: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 8,
    justifyContent: 'center',
  },
  filterPillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  filterPillValue: {
    fontWeight: '600',
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(6, 12, 22, 0.5)',
  },
  sheet: {
    maxHeight: '72%',
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderBottomWidth: 0,
  },
  sheetContent: {
    paddingTop: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    gap: theme.spacing[2],
  },
  sheetGrabber: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: theme.radii.pill,
    backgroundColor: theme.colors.glass.borderStrong,
    opacity: 0.9,
    marginTop: theme.spacing[1],
  },
  sheetHeader: {
    marginTop: theme.spacing[1],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[2],
  },
  sheetTitle: {
    flex: 1,
    fontSize: theme.typography.h3.fontSize - 2,
    lineHeight: theme.typography.h3.lineHeight - 2,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.glass.borderSoft,
    backgroundColor: theme.colors.glass.base,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonPressed: {
    opacity: theme.interaction.pressedOpacity,
    transform: [{ scale: theme.interaction.pressedScale }],
  },
  optionList: {
    gap: theme.spacing[1],
  },
  optionItem: {
    minHeight: 50,
  },
  optionItemSelected: {
    shadowColor: theme.colors.accent.primary,
    shadowOpacity: 0.11,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  optionItemContent: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    justifyContent: 'center',
  },
  optionItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[2],
  },
  optionLabel: {
    fontWeight: '600',
  },
  resetAction: {
    alignSelf: 'center',
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  resetActionPressed: {
    opacity: theme.interaction.pressedOpacity,
  },
  resetActionLabel: {
    letterSpacing: 0.25,
  },
});

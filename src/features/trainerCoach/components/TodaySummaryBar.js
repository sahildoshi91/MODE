import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ModeButton, ModeCard, ModeText } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';

function resolveSummaryTone(state) {
  if (state === 'sync_pending') {
    return 'warning';
  }
  if (state === 'calibration_incomplete' || state === 'drafts_pending' || state === 'clients_need_attention') {
    return 'accent';
  }
  return 'secondary';
}

export default function TodaySummaryBar({
  summary,
  collapsed = false,
  onActionPress,
  onToggleCollapsed,
}) {
  if (!summary) {
    return null;
  }
  const actions = Array.isArray(summary.actions) ? summary.actions.slice(0, 2) : [];
  const tone = resolveSummaryTone(summary.state);

  if (collapsed) {
    return (
      <Pressable
        onPress={() => onToggleCollapsed?.(false)}
        style={({ pressed }) => [
          styles.collapsedPill,
          pressed && styles.pressed,
        ]}
        testID="trainer-coach-summary-collapsed-pill"
      >
        <ModeText variant="caption" tone={tone}>{summary.title}</ModeText>
      </Pressable>
    );
  }

  return (
    <ModeCard variant="tinted" style={styles.card}>
      <View style={styles.header}>
        <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>Today Summary</ModeText>
        <Pressable onPress={() => onToggleCollapsed?.(true)} hitSlop={8}>
          <ModeText variant="caption" tone="tertiary">Collapse</ModeText>
        </Pressable>
      </View>
      <ModeText variant="bodySm" style={styles.title}>{summary.title}</ModeText>
      {summary.subtitle ? (
        <ModeText variant="caption" tone="secondary">{summary.subtitle}</ModeText>
      ) : null}
      {actions.length > 0 ? (
        <View style={styles.actions}>
          {actions.map((action) => (
            <ModeButton
              key={action.id}
              title={action.label}
              size="sm"
              variant="ghost"
              onPress={() => onActionPress?.(action)}
              style={styles.actionButton}
            />
          ))}
        </View>
      ) : null}
    </ModeCard>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: theme.spacing[1],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  title: {
    fontWeight: '700',
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[1],
    marginTop: theme.spacing[1],
  },
  actionButton: {
    marginTop: 0,
  },
  collapsedPill: {
    alignSelf: 'flex-start',
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    borderColor: theme.colors.border.default,
    backgroundColor: theme.colors.surface.elevated,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  pressed: {
    opacity: theme.interaction.pressedOpacity,
  },
});


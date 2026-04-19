import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ModeButton, ModeCard, ModeText } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';

function priorityTone(priorityTier) {
  const normalized = String(priorityTier || '').trim().toLowerCase();
  if (normalized === 'critical') {
    return 'error';
  }
  if (normalized === 'high') {
    return 'warning';
  }
  return 'secondary';
}

export default function DraftQueueDock({
  queue,
  minimized = false,
  onToggleMinimized,
  onOpenQueue,
  onOpenDraft,
}) {
  const items = Array.isArray(queue) ? queue : [];
  const count = items.length;
  const topItems = items.slice(0, 3);

  if (minimized) {
    return (
      <Pressable
        onPress={() => onToggleMinimized?.(false)}
        style={({ pressed }) => [
          styles.fab,
          pressed && styles.pressed,
        ]}
        testID="trainer-coach-draft-queue-fab"
      >
        <ModeText variant="caption" tone="inverse">{`${count} Draft${count === 1 ? '' : 's'}`}</ModeText>
      </Pressable>
    );
  }

  return (
    <ModeCard variant="surface" style={styles.card}>
      <View style={styles.header}>
        <View>
          <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>Draft Queue</ModeText>
          <ModeText variant="bodySm">{`${count} pending`}</ModeText>
        </View>
        <View style={styles.headerActions}>
          <ModeButton title="Open Queue" size="sm" variant="ghost" onPress={onOpenQueue} />
          <ModeButton title="Minimize" size="sm" variant="ghost" onPress={() => onToggleMinimized?.(true)} />
        </View>
      </View>
      {count === 0 ? (
        <ModeText variant="caption" tone="secondary">No pending drafts.</ModeText>
      ) : (
        <View style={styles.items}>
          {topItems.map((item) => (
            <Pressable
              key={item.output_id}
              onPress={() => onOpenDraft?.(item)}
              style={({ pressed }) => [
                styles.itemRow,
                pressed && styles.pressed,
              ]}
            >
              <ModeText variant="bodySm" style={styles.itemTitle}>
                {item.headline || item.summary || 'Untitled draft'}
              </ModeText>
              <ModeText variant="caption" tone={priorityTone(item.priority_tier)}>
                {`${item.priority_tier || 'normal'} · ${item.action_type || item.source_type}`}
              </ModeText>
            </Pressable>
          ))}
        </View>
      )}
    </ModeCard>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: theme.spacing[1],
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: theme.spacing[1],
  },
  sectionLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  headerActions: {
    alignItems: 'flex-end',
    gap: 2,
  },
  items: {
    gap: theme.spacing[1],
    marginTop: theme.spacing[1],
  },
  itemRow: {
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.border.default,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    backgroundColor: theme.colors.surface.elevated,
  },
  itemTitle: {
    fontWeight: '600',
  },
  fab: {
    alignSelf: 'flex-end',
    borderRadius: theme.radii.pill,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1] + 2,
    backgroundColor: theme.colors.cta.primaryBg,
    borderWidth: 1,
    borderColor: theme.colors.cta.primaryBorder,
    ...theme.shadows.soft,
  },
  pressed: {
    opacity: theme.interaction.pressedOpacity,
  },
});


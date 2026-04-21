import React from 'react';
import { StyleSheet, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';

import { theme } from '../theme';
import { ModeCard } from './ModeCard';
import { ModeText } from './ModeText';
import { SystemCountBadge } from './SystemCountBadge';

function MetricChip({ label, value, variant = 'default' }) {
  return (
    <View style={styles.metricChip}>
      <ModeText variant="caption" tone="secondary">
        {label}
      </ModeText>
      <SystemCountBadge value={value} variant={variant} />
    </View>
  );
}

export function SystemIdentityHeader({
  name,
  subtitle,
  clientsCount = 0,
  knowledgeCount = 0,
  reviewCount = 0,
  testID,
}) {
  return (
    <ModeCard testID={testID} variant="hero" style={styles.card}>
      <View style={styles.topRow}>
        <View style={styles.avatar}>
          <Feather name="shield" size={20} color={theme.colors.text.primary} />
        </View>
        <View style={styles.copyWrap}>
          <ModeText variant="h3">{name}</ModeText>
          <ModeText variant="bodySm" tone="secondary">
            {subtitle}
          </ModeText>
        </View>
      </View>

      <View style={styles.metricsRow}>
        <MetricChip label="Clients" value={clientsCount} />
        <MetricChip label="Knowledge" value={knowledgeCount} variant="accent" />
        <MetricChip label="Review" value={reviewCount} variant={reviewCount > 0 ? 'warning' : 'default'} />
      </View>
    </ModeCard>
  );
}

const styles = StyleSheet.create({
  card: {
    shadowColor: theme.colors.accent.primary,
    shadowOpacity: 0.18,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: theme.colors.glass.borderHero,
    backgroundColor: theme.colors.surface.base,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copyWrap: {
    flex: 1,
    gap: 4,
  },
  metricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  metricChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    borderColor: theme.colors.border.soft,
    backgroundColor: theme.colors.surface.base,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
});

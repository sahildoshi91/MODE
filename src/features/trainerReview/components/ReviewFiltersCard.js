import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ModeButton, ModeCard, ModeChip, ModeText } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import { SOURCE_FILTERS, STATUS_FILTERS } from '../constants';

export default function ReviewFiltersCard({
  statusFilter,
  sourceFilter,
  onStatusChange,
  onSourceChange,
  onRefresh,
}) {
  return (
    <ModeCard style={styles.filterCard}>
      <ModeText variant="label">Queue Filters</ModeText>
      <View style={styles.filterRow}>
        {STATUS_FILTERS.map((filter) => (
          <ModeChip
            key={filter.key}
            label={filter.label}
            selected={statusFilter === filter.key}
            onPress={() => onStatusChange(filter.key)}
          />
        ))}
      </View>
      <View style={styles.filterRow}>
        {SOURCE_FILTERS.map((filter) => (
          <ModeChip
            key={filter.key}
            label={filter.label}
            selected={sourceFilter === filter.key}
            onPress={() => onSourceChange(filter.key)}
          />
        ))}
      </View>
      <ModeButton
        variant="secondary"
        title="Refresh Queue"
        onPress={onRefresh}
        style={styles.refreshButton}
      />
    </ModeCard>
  );
}

const styles = StyleSheet.create({
  filterCard: {
    gap: theme.spacing[2],
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[1],
  },
  refreshButton: {
    alignSelf: 'flex-start',
  },
});

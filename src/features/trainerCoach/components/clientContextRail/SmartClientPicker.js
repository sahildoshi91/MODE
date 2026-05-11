import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Vibration,
  View,
} from 'react-native';

import { ModeText } from '../../../../../lib/components';
import { theme } from '../../../../../lib/theme';
import ClientRow from './ClientRow';

function filterInPlace(clients, query) {
  const normalizedQuery = String(query || '').trim().toLowerCase();
  if (!normalizedQuery) {
    return Array.isArray(clients) ? clients : [];
  }
  return (Array.isArray(clients) ? clients : []).filter((client) => {
    const name = String(client?.name || '').toLowerCase();
    const id = String(client?.id || '').toLowerCase();
    return name.includes(normalizedQuery) || id.includes(normalizedQuery);
  });
}

function removeByIds(clients, idsToRemove) {
  const blocked = new Set(idsToRemove);
  return (Array.isArray(clients) ? clients : []).filter((client) => !blocked.has(client.id));
}

function triggerSelectionHaptic() {
  try {
    Vibration.vibrate(8);
  } catch (_error) {
    // Best effort feedback only.
  }
}

function Section({
  title,
  clients,
  emptyMessage,
  selectedClientId,
  onSelectClient,
  testIDPrefix,
}) {
  const safeClients = Array.isArray(clients) ? clients : [];

  return (
    <View style={styles.section}>
      <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>{title}</ModeText>
      <View style={styles.listWrap}>
        {safeClients.length > 0 ? (
          safeClients.map((client) => (
            <ClientRow
              key={`${title}-${client.id}`}
              testID={`${testIDPrefix}-${title.toLowerCase().replace(/\s+/g, '-')}-${client.id}`}
              client={client}
              selected={selectedClientId === client.id}
              onPress={() => {
                triggerSelectionHaptic();
                onSelectClient?.(client.id);
              }}
            />
          ))
        ) : (
          <ModeText variant="caption" tone="secondary" style={styles.emptyCaption}>
            {emptyMessage}
          </ModeText>
        )}
      </View>
    </View>
  );
}

export default function SmartClientPicker({
  selectedClientId,
  todayClients,
  recentClients,
  allClients,
  searchQuery,
  onSelectClient,
  isSearching = false,
  isLoading = false,
  errorMessage = null,
  testIDPrefix = 'client-context-picker',
}) {
  const filteredRecentClients = useMemo(
    () => filterInPlace(recentClients, searchQuery),
    [recentClients, searchQuery],
  );
  const filteredTodayClients = useMemo(
    () => filterInPlace(todayClients, searchQuery),
    [todayClients, searchQuery],
  );
  const filteredAllClients = useMemo(
    () => filterInPlace(allClients, searchQuery),
    [allClients, searchQuery],
  );

  const recentIds = useMemo(
    () => (Array.isArray(filteredRecentClients) ? filteredRecentClients.map((item) => item.id) : []),
    [filteredRecentClients],
  );
  const todayCandidates = useMemo(
    () => removeByIds(filteredTodayClients, recentIds),
    [filteredTodayClients, recentIds],
  );
  const highlightedIds = useMemo(
    () => new Set([...recentIds, ...todayCandidates.map((item) => item.id)]),
    [recentIds, todayCandidates],
  );

  const allCandidates = useMemo(
    () => filteredAllClients.filter((item) => !highlightedIds.has(item.id)),
    [filteredAllClients, highlightedIds],
  );
  const isBusy = isLoading || isSearching;

  return (
    <View style={styles.root}>
      {isBusy ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={theme.colors.brand.progressCore} />
          <ModeText variant="caption" tone="secondary">
            {isSearching ? 'Refreshing clients...' : 'Loading clients...'}
          </ModeText>
        </View>
      ) : null}

      {errorMessage ? (
        <ModeText variant="caption" tone="error" style={styles.errorText}>
          {errorMessage}
        </ModeText>
      ) : null}

      <Section
        title="Most Recent"
        clients={filteredRecentClients}
        emptyMessage="No recent clients yet."
        selectedClientId={selectedClientId}
        onSelectClient={onSelectClient}
        testIDPrefix={testIDPrefix}
      />
      <Section
        title="Seeing Today"
        clients={todayCandidates}
        emptyMessage="No sessions today."
        selectedClientId={selectedClientId}
        onSelectClient={onSelectClient}
        testIDPrefix={testIDPrefix}
      />
      <Section
        title="All Clients"
        clients={allCandidates}
        emptyMessage="No clients found."
        selectedClientId={selectedClientId}
        onSelectClient={onSelectClient}
        testIDPrefix={testIDPrefix}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: theme.spacing[2],
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[1],
  },
  errorText: {
    paddingHorizontal: 2,
  },
  section: {
    gap: theme.spacing[1],
  },
  sectionLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  listWrap: {
    gap: theme.spacing[1],
  },
  emptyCaption: {
    paddingHorizontal: 2,
    paddingVertical: 2,
  },
});

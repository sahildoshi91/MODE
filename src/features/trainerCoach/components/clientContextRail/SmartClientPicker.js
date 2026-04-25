import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  TextInput,
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

function Section({ title, clients, selectedClientId, onSelectClient, testIDPrefix }) {
  if (!Array.isArray(clients) || clients.length === 0) {
    return null;
  }

  return (
    <View style={styles.section}>
      <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>{title}</ModeText>
      <View style={styles.listWrap}>
        {clients.map((client) => (
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
        ))}
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
  onSearchQueryChange,
  onSelectClient,
  isSearching = false,
  autoFocusSearch = false,
  testIDPrefix = 'client-context-picker',
}) {
  const filteredTodayClients = useMemo(
    () => filterInPlace(todayClients, searchQuery),
    [todayClients, searchQuery],
  );
  const filteredRecentClients = useMemo(
    () => filterInPlace(recentClients, searchQuery),
    [recentClients, searchQuery],
  );
  const filteredAllClients = useMemo(
    () => filterInPlace(allClients, searchQuery),
    [allClients, searchQuery],
  );

  const todayIds = useMemo(
    () => (Array.isArray(filteredTodayClients) ? filteredTodayClients.map((item) => item.id) : []),
    [filteredTodayClients],
  );
  const recentCandidates = useMemo(
    () => removeByIds(filteredRecentClients, todayIds),
    [filteredRecentClients, todayIds],
  );
  const highlightedIds = useMemo(
    () => new Set([...todayIds, ...recentCandidates.map((item) => item.id)]),
    [todayIds, recentCandidates],
  );

  const allCandidates = useMemo(
    () => filteredAllClients.filter((item) => !highlightedIds.has(item.id)),
    [filteredAllClients, highlightedIds],
  );

  return (
    <View style={styles.root}>
      <ModeText variant="bodySm" style={styles.sectionTitle}>Client</ModeText>
      <TextInput
        testID={`${testIDPrefix}-search`}
        value={searchQuery}
        onChangeText={onSearchQueryChange}
        placeholder="Search clients"
        placeholderTextColor={theme.colors.text.disabled}
        autoCorrect={false}
        autoCapitalize="words"
        autoFocus={autoFocusSearch}
        accessibilityLabel="Search clients"
        style={styles.searchInput}
      />

      {isSearching ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={theme.colors.brand.progressCore} />
          <ModeText variant="caption" tone="secondary">Searching clients...</ModeText>
        </View>
      ) : null}

      <Section
        title="Today"
        clients={filteredTodayClients}
        selectedClientId={selectedClientId}
        onSelectClient={onSelectClient}
        testIDPrefix={testIDPrefix}
      />
      <Section
        title="Recent"
        clients={recentCandidates}
        selectedClientId={selectedClientId}
        onSelectClient={onSelectClient}
        testIDPrefix={testIDPrefix}
      />
      <Section
        title="All Clients"
        clients={allCandidates}
        selectedClientId={selectedClientId}
        onSelectClient={onSelectClient}
        testIDPrefix={testIDPrefix}
      />

      {!isSearching && filteredTodayClients.length === 0 && recentCandidates.length === 0 && allCandidates.length === 0 ? (
        <ModeText variant="caption" tone="secondary">No clients found.</ModeText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: theme.spacing[1],
  },
  sectionTitle: {
    fontWeight: '700',
  },
  searchInput: {
    minHeight: 42,
    borderRadius: theme.radii.l,
    borderWidth: 1,
    borderColor: theme.colors.glass.borderSoft,
    backgroundColor: 'rgba(255,255,255,0.03)',
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    color: theme.colors.text.primary,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.body2.fontSize,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[1],
  },
  section: {
    gap: theme.spacing[1],
  },
  sectionLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  listWrap: {
    gap: theme.spacing[1],
  },
});

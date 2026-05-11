import React, { useMemo } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ModeText } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import { useChatHistory } from '../hooks/useChatHistory';
import ChatHeader from './ChatHeader';

function formatDateLabel(dateKey) {
  if (!dateKey) {
    return 'Earlier';
  }
  const date = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    return dateKey;
  }
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function formatTime(value) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function buildHistoryItems(groups) {
  return groups.flatMap((group) => [
    {
      type: 'header',
      id: `header-${group.date}`,
      date: group.date,
    },
    ...group.sessions.map((session) => ({
      type: 'session',
      id: session.id,
      session,
    })),
  ]);
}

function HistoryRow({
  session,
  role,
  onPress,
}) {
  const title = session?.title || 'Daily Coach Session';
  const summary = session?.summary || 'No summary yet.';
  const time = formatTime(session?.last_message_at || session?.updated_at || session?.created_at);
  const clientName = role === 'trainer' ? session?.client_name : null;

  return (
    <Pressable
      testID={`chat-history-row-${session.id}`}
      accessibilityRole="button"
      accessibilityLabel={`Open ${title}`}
      onPress={() => onPress?.(session)}
      style={({ pressed }) => [
        styles.row,
        pressed && styles.rowPressed,
      ]}
    >
      <View style={styles.rowTop}>
        <Text style={styles.rowTitle} numberOfLines={1}>{title}</Text>
        {time ? <Text style={styles.rowTime}>{time}</Text> : null}
      </View>
      {clientName ? (
        <Text style={styles.clientName} numberOfLines={1}>{clientName}</Text>
      ) : null}
      <Text style={styles.rowSummary} numberOfLines={2}>{summary}</Text>
    </Pressable>
  );
}

export default function ChatHistoryScreen({
  accessToken,
  role,
  sessionType,
  onBack,
  onOpenSession,
  bottomInset = 0,
  testID = 'chat-history-screen',
}) {
  const {
    groupedSessions,
    loading,
    refreshing,
    error,
    reload,
  } = useChatHistory({
    accessToken,
    role,
    sessionType,
  });

  const items = useMemo(() => buildHistoryItems(groupedSessions), [groupedSessions]);

  const renderItem = ({ item }) => {
    if (item.type === 'header') {
      return (
        <ModeText variant="caption" tone="tertiary" style={styles.dateHeader}>
          {formatDateLabel(item.date)}
        </ModeText>
      );
    }
    return (
      <HistoryRow
        session={item.session}
        role={role}
        onPress={onOpenSession}
      />
    );
  };

  const emptyCopy = loading
    ? 'Loading chat history...'
    : (error?.message || 'No archived sessions yet.');

  return (
    <View testID={testID} style={styles.screen}>
      <ChatHeader
        role={role}
        title="History"
        subtitle="Daily sessions"
        onBack={onBack}
      />
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={reload}
            tintColor={theme.colors.text.secondary}
          />
        )}
        ListEmptyComponent={(
          <View style={styles.emptyWrap}>
            <ModeText variant="bodySm" tone="secondary" style={styles.emptyText}>
              {emptyCopy}
            </ModeText>
          </View>
        )}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: Math.max(bottomInset, 18) + theme.spacing[4] },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background.app,
  },
  listContent: {
    flexGrow: 1,
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[1],
  },
  dateHeader: {
    marginTop: theme.spacing[3],
    marginBottom: theme.spacing[1],
    paddingHorizontal: theme.spacing[1],
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    fontWeight: '700',
  },
  row: {
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[1],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(214, 230, 255, 0.08)',
  },
  rowPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.045)',
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
  },
  rowTitle: {
    flex: 1,
    color: theme.colors.text.primary,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.body1.fontSize,
    lineHeight: theme.typography.body1.lineHeight,
    fontWeight: '700',
  },
  rowTime: {
    color: theme.colors.text.tertiary,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.body3.fontSize,
    lineHeight: theme.typography.body3.lineHeight,
    fontWeight: '600',
  },
  clientName: {
    color: theme.colors.accent.primary,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.body3.fontSize,
    lineHeight: theme.typography.body3.lineHeight,
    fontWeight: '700',
    marginTop: 1,
  },
  rowSummary: {
    color: theme.colors.text.secondary,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.body2.fontSize,
    lineHeight: theme.typography.body2.lineHeight,
    marginTop: 2,
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing[6],
  },
  emptyText: {
    textAlign: 'center',
  },
});

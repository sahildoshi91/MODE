import React, { useCallback, useRef } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import { ModeButton, ModeText } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import { useOpeningSummary } from '../hooks/useOpeningSummary';
import ChatMessageBubble from './ChatMessageBubble';
import StreamingAIMessage from './StreamingAIMessage';
import SuggestedActionChips from './SuggestedActionChips';

export default function ChatMessageList({
  messages = [],
  suggestedActions = [],
  readOnly = false,
  loading = false,
  error = null,
  onRetry,
  onSelectSuggestedAction,
  bottomInset = 0,
  testID = 'chat-message-list',
}) {
  const listRef = useRef(null);
  const shouldAutoScrollRef = useRef(true);
  const { openingMessage, chips, shouldShowChips } = useOpeningSummary({
    messages,
    suggestedActions,
    readOnly,
  });

  const handleScroll = useCallback((event) => {
    const {
      contentOffset,
      contentSize,
      layoutMeasurement,
    } = event.nativeEvent || {};
    const distanceFromBottom = (contentSize?.height || 0)
      - ((contentOffset?.y || 0) + (layoutMeasurement?.height || 0));
    shouldAutoScrollRef.current = distanceFromBottom < 90;
  }, []);

  const handleContentSizeChange = useCallback(() => {
    if (!shouldAutoScrollRef.current) {
      return;
    }
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd?.({ animated: true });
    });
  }, []);

  const renderItem = useCallback(({ item, index }) => {
    const isAssistant = item.role !== 'user';
    const showChips = shouldShowChips && openingMessage?.id === item.id;
    const previousMessage = messages[index - 1];
    const showSpeakerLabel = !previousMessage || previousMessage.role !== item.role;

    return (
      <View style={styles.messageWrap}>
        {isAssistant ? (
          <StreamingAIMessage
            message={item}
            showSpeakerLabel={showSpeakerLabel}
          />
        ) : (
          <ChatMessageBubble
            message={item}
            showSpeakerLabel={showSpeakerLabel}
          />
        )}
        {showChips ? (
          <SuggestedActionChips
            actions={chips}
            disabled={readOnly}
            onSelect={onSelectSuggestedAction}
          />
        ) : null}
      </View>
    );
  }, [chips, messages, onSelectSuggestedAction, openingMessage?.id, readOnly, shouldShowChips]);

  const errorDiagnostic = error && typeof __DEV__ === 'boolean' && __DEV__
    ? [error.request_path || error.path, error.api_base_url].filter(Boolean).join(' · ')
    : null;
  const errorHint = error?.hint && typeof __DEV__ === 'boolean' && __DEV__
    ? error.hint
    : null;
  const listEmptyComponent = loading ? (
    <View style={styles.emptyWrap}>
      <ModeText variant="bodySm" tone="secondary" style={styles.emptyText}>
        {`Starting today's chat...`}
      </ModeText>
    </View>
  ) : (
    <View style={styles.emptyWrap}>
      <ModeText variant="bodySm" tone="secondary" style={styles.emptyText}>
        {error?.message || 'Your coach is ready when you are.'}
      </ModeText>
      {errorDiagnostic ? (
        <ModeText variant="caption" tone="tertiary" style={styles.diagnosticText}>
          {errorDiagnostic}
        </ModeText>
      ) : null}
      {errorHint ? (
        <ModeText variant="caption" tone="tertiary" style={styles.hintText}>
          {errorHint}
        </ModeText>
      ) : null}
      {error && typeof onRetry === 'function' ? (
        <ModeButton
          title="Retry"
          variant="secondary"
          size="sm"
          onPress={onRetry}
          style={styles.retryButton}
          testID="chat-session-retry-button"
        />
      ) : null}
    </View>
  );

  return (
    <FlatList
      ref={listRef}
      testID={testID}
      data={messages}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      ListEmptyComponent={listEmptyComponent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      onScroll={handleScroll}
      scrollEventThrottle={16}
      onContentSizeChange={handleContentSizeChange}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: Math.max(bottomInset, 18) + theme.spacing[3] },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    gap: theme.spacing[2],
  },
  messageWrap: {
    width: '100%',
    gap: theme.spacing[1],
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
  diagnosticText: {
    textAlign: 'center',
    marginTop: theme.spacing[1],
  },
  hintText: {
    textAlign: 'center',
    marginTop: theme.spacing[1],
  },
  retryButton: {
    marginTop: theme.spacing[3],
    maxWidth: 180,
  },
});

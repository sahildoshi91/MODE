import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import {
  HeaderBar,
  ModeText,
  SafeScreen,
} from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import ChatBubble from '../components/ChatBubble';
import CoachComposer from '../components/CoachComposer';
import QuickReplies from '../components/QuickReplies';
import TypingIndicator from '../components/TypingIndicator';
import { useChatConversation } from '../hooks/useChatConversation';

const KEYBOARD_OPEN_DOCK_PADDING = theme.spacing[2];

export default function CoachChatScreen({
  accessToken,
  launchContext,
  bottomInset = 0,
  onBack = null,
}) {
  const [draft, setDraft] = useState('');
  const [dockHeight, setDockHeight] = useState(0);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const listRef = useRef(null);
  const dockAnchorInset = Math.max(bottomInset, 0);
  const backAccessibilityLabel =
    launchContext?.entrypoint === 'generated_nutrition'
      ? 'Back to generated nutrition plan'
      : 'Back to generated workout';

  const {
    messages,
    quickReplies,
    isSending,
    error,
    hasRetryableFailure,
    sendMessage,
    retryLastFailedMessage,
  } = useChatConversation(accessToken, launchContext);

  const scrollToLatest = useCallback((animated = true) => {
    requestAnimationFrame(() => {
      if (listRef.current?.scrollToEnd) {
        listRef.current.scrollToEnd({ animated });
      }
    });
  }, []);

  const handleSend = async () => {
    const message = draft.trim();
    if (!message) {
      return;
    }
    const sent = await sendMessage(message);
    if (sent) {
      setDraft('');
    }
  };

  const handleQuickReply = async (reply) => {
    const sent = await sendMessage(reply);
    if (sent) {
      setDraft('');
    }
  };

  const handleRetryLastMessage = async () => {
    const sent = await retryLastFailedMessage();
    if (sent) {
      setDraft('');
    }
  };

  useEffect(() => {
    scrollToLatest(false);
  }, [scrollToLatest]);

  useEffect(() => {
    scrollToLatest(true);
  }, [messages.length, isSending, scrollToLatest]);

  useEffect(() => {
    const openEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const closeEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const keyboardOpenSubscription = Keyboard.addListener(openEvent, () => {
      setIsKeyboardVisible(true);
      scrollToLatest(true);
    });
    const keyboardCloseSubscription = Keyboard.addListener(closeEvent, () => {
      setIsKeyboardVisible(false);
    });

    return () => {
      keyboardOpenSubscription.remove();
      keyboardCloseSubscription.remove();
    };
  }, [scrollToLatest]);

  return (
    <SafeScreen includeTopInset={false} style={styles.screen}>
      <HeaderBar
        title="Coach Chat"
        onBack={onBack}
        backAccessibilityLabel={backAccessibilityLabel}
      />

      <KeyboardAvoidingView
        style={styles.content}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <View style={styles.chatViewport}>
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <ChatBubble
                role={item.role}
                text={item.text}
                isError={item.isError}
                fallbackTriggered={item.fallbackTriggered}
              />
            )}
            style={styles.messagesList}
            contentContainerStyle={[
              styles.messages,
              { paddingBottom: dockHeight + theme.spacing[2] },
            ]}
            ListFooterComponent={isSending ? <TypingIndicator /> : <View style={styles.threadSpacer} />}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => {
              scrollToLatest(false);
            }}
          />

          <View
            onLayout={(event) => setDockHeight(event.nativeEvent.layout.height)}
            style={[
              styles.dock,
              {
                paddingBottom: isKeyboardVisible ? KEYBOARD_OPEN_DOCK_PADDING : dockAnchorInset,
              },
            ]}
          >
            {hasRetryableFailure ? (
              <View style={styles.errorRow}>
                <ModeText variant="caption" tone="error" style={styles.errorText}>
                  {error || 'Coach is temporarily unavailable.'}
                </ModeText>
                <Pressable
                  accessibilityRole="button"
                  onPress={handleRetryLastMessage}
                  disabled={isSending}
                  style={({ pressed }) => [
                    styles.retryButton,
                    (isSending || pressed) && styles.retryButtonMuted,
                  ]}
                >
                  <ModeText variant="label" tone="accent">
                    {isSending ? 'Retrying...' : 'Retry'}
                  </ModeText>
                </Pressable>
              </View>
            ) : null}

            <QuickReplies
              replies={quickReplies}
              disabled={isSending}
              onSelect={handleQuickReply}
              style={styles.quickReplies}
              contentContainerStyle={styles.quickRepliesContent}
            />

            <CoachComposer
              value={draft}
              onChangeText={setDraft}
              onSend={handleSend}
              disabled={isSending}
              onFocus={() => scrollToLatest(false)}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: theme.colors.surface.canvas,
  },
  content: {
    flex: 1,
  },
  chatViewport: {
    flex: 1,
    position: 'relative',
  },
  messagesList: {
    flex: 1,
  },
  messages: {
    paddingTop: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
  },
  threadSpacer: {
    height: theme.spacing[1],
  },
  dock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border.soft,
    backgroundColor: theme.colors.surface.canvas,
  },
  errorRow: {
    marginBottom: theme.spacing[1],
    borderRadius: theme.radii.s,
    borderWidth: 1,
    borderColor: 'rgba(196, 138, 138, 0.45)',
    backgroundColor: 'rgba(232, 207, 207, 0.35)',
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[1],
  },
  errorText: {
    flex: 1,
  },
  retryButton: {
    paddingVertical: theme.spacing[1] - 2,
    paddingHorizontal: theme.spacing[1],
  },
  retryButtonMuted: {
    opacity: 0.65,
  },
  quickReplies: {
    marginBottom: theme.spacing[1],
  },
  quickRepliesContent: {
    paddingHorizontal: 0,
  },
});

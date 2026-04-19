import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';

import {
  HeaderBar,
  ModeText,
  SafeScreen,
  GlassSurface,
  HeroOverlayCard,
} from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import ChatBubble from '../components/ChatBubble';
import CoachComposer from '../components/CoachComposer';
import QuickReplies from '../components/QuickReplies';
import TypingIndicator from '../components/TypingIndicator';
import { useChatConversation } from '../hooks/useChatConversation';

const KEYBOARD_OPEN_DOCK_PADDING = theme.spacing[2];
const COPY_FEEDBACK_TIMEOUT_MS = 2200;
const NEAR_BOTTOM_THRESHOLD_PX = 120;

function resolveSessionIntro(launchContext) {
  const entrypoint = String(launchContext?.entrypoint || '').trim().toLowerCase();
  if (entrypoint === 'trainer_agent_training') {
    return {
      eyebrow: 'Coach Calibration',
      title: 'Refine Your Coaching Voice',
      body: 'Review and approve sample responses so every client interaction sounds like you.',
    };
  }
  if (entrypoint === 'generated_workout') {
    return {
      eyebrow: 'Workout Coach',
      title: 'Plan Loaded',
      body: 'Use this thread to adapt intensity, swap movements, or adjust volume before training.',
    };
  }
  if (entrypoint === 'generated_nutrition') {
    return {
      eyebrow: 'Nutrition Coach',
      title: 'Fuel Plan Loaded',
      body: 'Ask for substitutions, macro adjustments, and adherence strategy for today.',
    };
  }
  return {
    eyebrow: 'Coach Channel',
    title: 'High-Intent Conversation',
    body: 'Use this space for direct, disciplined coaching aligned to your goals.',
  };
}

function withFallback(value) {
  if (value === null || value === undefined || value === '') {
    return 'n/a';
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(', ') : 'n/a';
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch (_error) {
      return '[unserializable]';
    }
  }
  return String(value);
}

function asNonNegativeNumber(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

function buildChatErrorSupportBundle({ error, errorDetails, launchContext }) {
  return [
    'MODE Chat Error Diagnostics',
    `Timestamp: ${new Date().toISOString()}`,
    `Message: ${withFallback(error)}`,
    `Path: ${withFallback(errorDetails?.path)}`,
    `Stage: ${withFallback(errorDetails?.stage)}`,
    `Resolved API Base: ${withFallback(errorDetails?.resolved_api_base_url)}`,
    `Attempted Hosts: ${withFallback(errorDetails?.attempted_base_urls)}`,
    `Last Successful Host: ${withFallback(errorDetails?.last_successful_base_url)}`,
    `Raw Network Error: ${withFallback(errorDetails?.raw_error_message)}`,
    `Launch Context: ${withFallback(launchContext)}`,
  ].join('\n');
}

export default function CoachChatScreen({
  accessToken,
  launchContext,
  bottomInset = 0,
  onBack = null,
  topToolbar = null,
}) {
  const [draft, setDraft] = useState('');
  const [dockHeight, setDockHeight] = useState(0);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(null);
  const listRef = useRef(null);
  const pendingScrollRef = useRef(false);
  const copyFeedbackTimerRef = useRef(null);
  const scrollTimeoutsRef = useRef([]);
  const scrollMetricsRef = useRef({
    offset: 0,
    contentHeight: 0,
    layoutHeight: 0,
    nearBottom: true,
  });
  const keyboardOffsetShiftRef = useRef(0);
  const dockAnchorInset = Math.max(bottomInset, 0);
  const sessionIntro = useMemo(() => resolveSessionIntro(launchContext), [launchContext]);
  const backAccessibilityLabel =
    launchContext?.entrypoint === 'generated_nutrition'
      ? 'Back to generated nutrition plan'
      : 'Back to generated workout';

  const {
    messages,
    quickReplies,
    isSending,
    error,
    errorDetails,
    hasRetryableFailure,
    sendMessage,
    retryFailedRequest,
  } = useChatConversation(accessToken, launchContext);

  const updateScrollMetrics = useCallback((partial = {}) => {
    const current = scrollMetricsRef.current;
    const next = {
      offset: partial.offset === undefined
        ? current.offset
        : asNonNegativeNumber(partial.offset, current.offset),
      contentHeight: partial.contentHeight === undefined
        ? current.contentHeight
        : asNonNegativeNumber(partial.contentHeight, current.contentHeight),
      layoutHeight: partial.layoutHeight === undefined
        ? current.layoutHeight
        : asNonNegativeNumber(partial.layoutHeight, current.layoutHeight),
      nearBottom: current.nearBottom,
    };
    const distanceFromBottom = next.contentHeight - (next.offset + next.layoutHeight);
    next.nearBottom = distanceFromBottom <= NEAR_BOTTOM_THRESHOLD_PX;
    scrollMetricsRef.current = next;
    return next;
  }, []);

  const scrollToOffset = useCallback((offset, animated = false) => {
    const safeOffset = asNonNegativeNumber(offset, 0);
    updateScrollMetrics({ offset: safeOffset });
    if (listRef.current?.scrollToOffset) {
      listRef.current.scrollToOffset({ offset: safeOffset, animated });
    }
  }, [updateScrollMetrics]);

  const scrollToLatest = useCallback((animated = true) => {
    requestAnimationFrame(() => {
      const metrics = scrollMetricsRef.current;
      const maxOffset = Math.max(metrics.contentHeight - metrics.layoutHeight, 0);
      updateScrollMetrics({ offset: maxOffset });
      if (listRef.current?.scrollToEnd) {
        listRef.current.scrollToEnd({ animated });
      } else if (listRef.current?.scrollToOffset) {
        listRef.current.scrollToOffset({ offset: maxOffset, animated });
      }
    });
  }, [updateScrollMetrics]);

  const scrollToLatestWithRetries = useCallback((animated = true) => {
    scrollToLatest(animated);
    const shortTimeoutId = setTimeout(() => {
      scrollTimeoutsRef.current = scrollTimeoutsRef.current.filter((id) => id !== shortTimeoutId);
      scrollToLatest(animated);
    }, 45);
    const longTimeoutId = setTimeout(() => {
      scrollTimeoutsRef.current = scrollTimeoutsRef.current.filter((id) => id !== longTimeoutId);
      scrollToLatest(animated);
    }, 130);
    scrollTimeoutsRef.current.push(shortTimeoutId, longTimeoutId);
  }, [scrollToLatest]);

  const showCopyFeedback = useCallback((message) => {
    if (copyFeedbackTimerRef.current) {
      clearTimeout(copyFeedbackTimerRef.current);
    }
    setCopyFeedback(message);
    copyFeedbackTimerRef.current = setTimeout(() => {
      setCopyFeedback(null);
      copyFeedbackTimerRef.current = null;
    }, COPY_FEEDBACK_TIMEOUT_MS);
  }, []);

  const queueAutoScroll = useCallback(() => {
    pendingScrollRef.current = true;
    scrollToLatestWithRetries(true);
  }, [scrollToLatestWithRetries]);

  const keepCurrentViewportAboveComposer = useCallback((keyboardHeight) => {
    const metrics = scrollMetricsRef.current;
    if (metrics.nearBottom) {
      keyboardOffsetShiftRef.current = 0;
      scrollToLatestWithRetries(true);
      return;
    }

    const desiredShift = asNonNegativeNumber(keyboardHeight, 0);
    if (desiredShift <= 0) {
      keyboardOffsetShiftRef.current = 0;
      return;
    }
    const maxOffset = Math.max(metrics.contentHeight - metrics.layoutHeight, 0);
    const nextOffset = Math.min(metrics.offset + desiredShift, maxOffset);
    const appliedShift = Math.max(nextOffset - metrics.offset, 0);
    keyboardOffsetShiftRef.current = appliedShift;
    if (appliedShift > 0) {
      scrollToOffset(nextOffset, false);
    }
  }, [scrollToLatestWithRetries, scrollToOffset]);

  const restoreViewportAfterKeyboardHide = useCallback(() => {
    const appliedShift = keyboardOffsetShiftRef.current;
    keyboardOffsetShiftRef.current = 0;
    if (appliedShift <= 0) {
      return;
    }
    const metrics = scrollMetricsRef.current;
    const nextOffset = Math.max(metrics.offset - appliedShift, 0);
    scrollToOffset(nextOffset, false);
  }, [scrollToOffset]);

  const handleSend = async () => {
    const message = draft.trim();
    if (!message) {
      return;
    }
    queueAutoScroll();
    const sent = await sendMessage(message);
    if (sent) {
      setDraft('');
      scrollToLatestWithRetries(true);
    }
  };

  const handleQuickReply = async (reply) => {
    queueAutoScroll();
    const sent = await sendMessage(reply);
    if (sent) {
      setDraft('');
      scrollToLatestWithRetries(true);
    }
  };

  const handleRetryLastMessage = async () => {
    queueAutoScroll();
    const sent = await retryFailedRequest();
    if (sent) {
      setDraft('');
      scrollToLatestWithRetries(true);
    }
  };

  const handleChecklistCommand = async (command) => {
    queueAutoScroll();
    const sent = await sendMessage(command);
    if (sent) {
      setDraft('');
      scrollToLatestWithRetries(true);
    }
  };

  const handleCopyError = async () => {
    try {
      const supportBundle = buildChatErrorSupportBundle({
        error,
        errorDetails,
        launchContext,
      });
      await Clipboard.setStringAsync(supportBundle);
      showCopyFeedback('Copied error details');
    } catch (_error) {
      showCopyFeedback('Unable to copy error details');
    }
  };

  useEffect(() => {
    scrollToLatest(false);
  }, [scrollToLatest]);

  useEffect(() => {
    const openEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const closeEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const keyboardOpenSubscription = Keyboard.addListener(openEvent, (event) => {
      setIsKeyboardVisible(true);
      keepCurrentViewportAboveComposer(event?.endCoordinates?.height);
    });
    const keyboardCloseSubscription = Keyboard.addListener(closeEvent, () => {
      setIsKeyboardVisible(false);
      restoreViewportAfterKeyboardHide();
    });

    return () => {
      keyboardOpenSubscription.remove();
      keyboardCloseSubscription.remove();
    };
  }, [keepCurrentViewportAboveComposer, restoreViewportAfterKeyboardHide]);

  useEffect(() => () => {
    if (copyFeedbackTimerRef.current) {
      clearTimeout(copyFeedbackTimerRef.current);
      copyFeedbackTimerRef.current = null;
    }
    scrollTimeoutsRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
    scrollTimeoutsRef.current = [];
  }, []);

  return (
    <SafeScreen includeTopInset={false} style={styles.screen} atmosphere="chat">
      <HeaderBar
        title="Coach Chat"
        onBack={onBack}
        backAccessibilityLabel={backAccessibilityLabel}
      />
      {topToolbar ? (
        <View style={styles.toolbarContainer}>
          {topToolbar}
        </View>
      ) : null}

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
            onLayout={(event) => {
              updateScrollMetrics({ layoutHeight: event?.nativeEvent?.layout?.height });
            }}
            renderItem={({ item, index }) => {
              if (item?.kind === 'assistant_progress') {
                return (
                  <View style={styles.messageItem}>
                    <TypingIndicator text={item?.text} />
                  </View>
                );
              }
              const trainerOnboardingPatch = item?.profilePatch?.trainer_onboarding
                && typeof item.profilePatch.trainer_onboarding === 'object'
                ? item.profilePatch.trainer_onboarding
                : null;
              const stepPreview = trainerOnboardingPatch?.step_preview
                && typeof trainerOnboardingPatch.step_preview === 'object'
                ? trainerOnboardingPatch.step_preview
                : null;
              const checklist = trainerOnboardingPatch?.calibration_checklist
                && typeof trainerOnboardingPatch.calibration_checklist === 'object'
                ? trainerOnboardingPatch.calibration_checklist
                : null;
              const samples = Array.isArray(checklist?.samples) ? checklist.samples : [];
              const approvedCount = Number.isFinite(Number(checklist?.approved_count))
                ? Number(checklist.approved_count)
                : 0;
              const totalCount = Number.isFinite(Number(checklist?.total))
                ? Number(checklist.total)
                : samples.length;
              const previousRole = index > 0 ? messages[index - 1]?.role : null;
              const showSpeakerLabel = index === 0 || previousRole !== item.role;
              return (
                <View style={styles.messageItem}>
                  <ChatBubble
                    role={item.role}
                    text={item.text}
                    isError={item.isError}
                    fallbackTriggered={item.fallbackTriggered}
                    showSpeakerLabel={showSpeakerLabel}
                  />
                  {stepPreview ? (
                    <View style={styles.previewCard}>
                      <ModeText variant="caption" tone="tertiary">Sample reply preview</ModeText>
                      <ModeText variant="caption" tone="secondary" style={styles.previewScenario}>
                        {stepPreview.scenario}
                      </ModeText>
                      <ModeText variant="bodySm" style={styles.previewResponse}>
                        {stepPreview.sample_response}
                      </ModeText>
                    </View>
                  ) : null}
                  {checklist ? (
                    <View style={styles.checklistCard}>
                      <View style={styles.checklistHeader}>
                        <ModeText variant="label">Final calibration checklist</ModeText>
                        <ModeText variant="caption" tone="tertiary">
                          {`${approvedCount}/${totalCount} approved`}
                        </ModeText>
                      </View>
                      {samples.map((sample, idx) => {
                        const sampleIndex = Number.isFinite(Number(sample?.index))
                          ? Number(sample.index)
                          : (idx + 1);
                        const isApproved = String(sample?.status || '').toLowerCase() === 'approved';
                        return (
                          <View key={`${item.id}-sample-${sampleIndex}`} style={styles.checklistItem}>
                            <ModeText variant="caption" tone="secondary" style={styles.checklistScenario}>
                              {`${sampleIndex}. ${sample?.scenario || 'Scenario'}`}
                            </ModeText>
                            <ModeText variant="bodySm" style={styles.checklistResponse}>
                              {sample?.response || ''}
                            </ModeText>
                            <View style={styles.checklistActions}>
                              <Pressable
                                accessibilityRole="button"
                                testID={`coach-chat-checklist-approve-${sampleIndex}`}
                                onPress={() => handleChecklistCommand(`approve ${sampleIndex}`)}
                                disabled={isSending || isApproved}
                                style={({ pressed }) => [
                                  styles.checklistActionButton,
                                  styles.checklistApproveButton,
                                  pressed && !isSending && !isApproved && styles.checklistActionButtonPressed,
                                  (isSending || isApproved) && styles.checklistActionButtonMuted,
                                ]}
                              >
                                <ModeText variant="caption" tone="accent">
                                  {isApproved ? 'Approved' : 'Approve'}
                                </ModeText>
                              </Pressable>
                              <Pressable
                                accessibilityRole="button"
                                testID={`coach-chat-checklist-regenerate-${sampleIndex}`}
                                onPress={() => handleChecklistCommand(`reject ${sampleIndex}`)}
                                disabled={isSending}
                                style={({ pressed }) => [
                                  styles.checklistActionButton,
                                  pressed && !isSending && styles.checklistActionButtonPressed,
                                  isSending && styles.checklistActionButtonMuted,
                                ]}
                              >
                                <ModeText variant="caption" tone="secondary">Regenerate</ModeText>
                              </Pressable>
                            </View>
                          </View>
                        );
                      })}
                      <Pressable
                        accessibilityRole="button"
                        testID="coach-chat-checklist-approve-all"
                        onPress={() => handleChecklistCommand('approve all')}
                        disabled={isSending}
                        style={({ pressed }) => [
                          styles.checklistApproveAllButton,
                          pressed && !isSending && styles.checklistActionButtonPressed,
                          isSending && styles.checklistActionButtonMuted,
                        ]}
                      >
                        <ModeText variant="caption" tone="accent">Approve all</ModeText>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              );
            }}
            style={styles.messagesList}
            contentContainerStyle={[
              styles.messages,
              { paddingBottom: dockHeight + theme.spacing[2] },
            ]}
            ListHeaderComponent={(
              <HeroOverlayCard
                eyebrow={sessionIntro.eyebrow}
                title={sessionIntro.title}
                body={sessionIntro.body}
                style={styles.sessionIntroCard}
                testID="coach-chat-session-intro"
              />
            )}
            ListFooterComponent={<View style={styles.threadSpacer} />}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            showsVerticalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={(event) => {
              const nativeEvent = event?.nativeEvent || {};
              updateScrollMetrics({
                offset: nativeEvent?.contentOffset?.y,
                contentHeight: nativeEvent?.contentSize?.height,
                layoutHeight: nativeEvent?.layoutMeasurement?.height,
              });
            }}
            onContentSizeChange={(_width, height) => {
              const wasNearBottom = scrollMetricsRef.current.nearBottom;
              updateScrollMetrics({ contentHeight: height });
              if (pendingScrollRef.current) {
                pendingScrollRef.current = false;
                scrollToLatestWithRetries(true);
                return;
              }
              if (wasNearBottom) {
                scrollToLatest(false);
              }
            }}
          />

          <GlassSurface
            onLayout={(event) => setDockHeight(event.nativeEvent.layout.height)}
            state="elevated"
            radius="l"
            blur="input"
            padding={theme.spacing[2]}
            style={[
              styles.dock,
              {
                paddingBottom: isKeyboardVisible ? KEYBOARD_OPEN_DOCK_PADDING : dockAnchorInset,
              },
            ]}
            contentStyle={styles.dockContent}
          >
            {hasRetryableFailure ? (
              <GlassSurface
                state="muted"
                radius="s"
                style={styles.errorRow}
                contentStyle={styles.errorRowContent}
                fillColor={theme.colors.feedback.errorBg}
                borderColor={theme.colors.feedback.errorBorder}
              >
                <View style={styles.errorTextWrap}>
                  <ModeText variant="caption" tone="error" style={styles.errorText}>
                    {error || 'Coach is temporarily unavailable.'}
                  </ModeText>
                  {copyFeedback ? (
                    <ModeText variant="caption" tone="secondary" style={styles.copyFeedback}>
                      {copyFeedback}
                    </ModeText>
                  ) : null}
                </View>
                <View style={styles.errorActions}>
                  <Pressable
                    accessibilityRole="button"
                    testID="coach-chat-retry-button"
                    onPress={handleRetryLastMessage}
                    disabled={isSending}
                    style={({ pressed }) => [
                      styles.retryButton,
                      pressed && !isSending && styles.retryButtonPressed,
                      isSending && styles.retryButtonMuted,
                    ]}
                  >
                    <ModeText variant="label" tone="accent">
                      {isSending ? 'Retrying...' : 'Retry'}
                    </ModeText>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    testID="coach-chat-copy-error-button"
                    onPress={handleCopyError}
                    disabled={isSending}
                    style={({ pressed }) => [
                      styles.retryButton,
                      pressed && !isSending && styles.retryButtonPressed,
                      isSending && styles.retryButtonMuted,
                    ]}
                  >
                    <ModeText variant="label" tone="secondary">Copy error</ModeText>
                  </Pressable>
                </View>
              </GlassSurface>
            ) : null}

            <QuickReplies
              replies={quickReplies}
              disabled={isSending}
              onSelect={handleQuickReply}
              style={styles.quickReplies}
              contentContainerStyle={styles.quickRepliesContent}
            />
            {quickReplies?.length ? (
              <ModeText variant="caption" tone="tertiary" style={styles.quickRepliesLabel}>
                Coach shortcuts
              </ModeText>
            ) : null}

            <CoachComposer
              value={draft}
              onChangeText={setDraft}
              onSend={handleSend}
              disabled={isSending}
            />
          </GlassSurface>
        </View>
      </KeyboardAvoidingView>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: theme.colors.background.app,
  },
  content: {
    flex: 1,
  },
  toolbarContainer: {
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[1],
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
  sessionIntroCard: {
    marginBottom: theme.spacing[2],
  },
  messageItem: {
    width: '100%',
    marginBottom: 2,
  },
  threadSpacer: {
    height: theme.spacing[1],
  },
  dock: {
    position: 'absolute',
    left: theme.spacing[2],
    right: theme.spacing[2],
    bottom: 0,
    marginBottom: theme.spacing[1],
  },
  dockContent: {
    paddingTop: theme.spacing[1],
  },
  errorRow: {
    marginBottom: theme.spacing[1],
  },
  errorRowContent: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: theme.spacing[1],
  },
  errorTextWrap: {
    flex: 1,
    gap: 2,
  },
  errorText: {
    flex: 1,
  },
  copyFeedback: {
    marginTop: 2,
  },
  errorActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  retryButton: {
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    borderColor: theme.colors.glass.borderSoft,
    backgroundColor: theme.colors.glass.base,
    paddingVertical: theme.spacing[1] - 2,
    paddingHorizontal: theme.spacing[2],
  },
  retryButtonPressed: {
    opacity: theme.interaction.pressedOpacity,
    transform: [{ scale: theme.interaction.pressedScale }],
  },
  retryButtonMuted: {
    opacity: theme.interaction.disabledOpacity,
  },
  previewCard: {
    alignSelf: 'flex-start',
    width: '88%',
    marginTop: -theme.spacing[1] + 2,
    marginBottom: theme.spacing[1],
    marginLeft: theme.spacing[1],
    borderRadius: theme.radii.m,
    borderWidth: 1,
    borderColor: theme.colors.glass.borderDefault,
    backgroundColor: theme.colors.glass.elevated,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    gap: 4,
  },
  previewScenario: {
    marginTop: 2,
  },
  previewResponse: {
    marginTop: 1,
  },
  checklistCard: {
    width: '92%',
    marginTop: -theme.spacing[1] + 2,
    marginBottom: theme.spacing[1],
    marginLeft: theme.spacing[1],
    borderRadius: theme.radii.m,
    borderWidth: 1,
    borderColor: theme.colors.glass.borderDefault,
    backgroundColor: theme.colors.glass.elevated,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    gap: theme.spacing[1],
  },
  checklistHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[1],
  },
  checklistItem: {
    borderRadius: theme.radii.s,
    borderWidth: 1,
    borderColor: theme.colors.glass.borderSoft,
    backgroundColor: theme.colors.glass.base,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    gap: 6,
  },
  checklistScenario: {
    fontWeight: '600',
  },
  checklistResponse: {
    lineHeight: 20,
  },
  checklistActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  checklistActionButton: {
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    borderColor: theme.colors.glass.borderDefault,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 4,
    backgroundColor: theme.colors.glass.base,
  },
  checklistApproveButton: {
    borderColor: theme.colors.accent.primary,
    backgroundColor: theme.colors.accent.soft,
  },
  checklistActionButtonMuted: {
    opacity: theme.interaction.disabledOpacity,
  },
  checklistActionButtonPressed: {
    opacity: theme.interaction.pressedOpacity,
    transform: [{ scale: theme.interaction.pressedScale }],
  },
  checklistApproveAllButton: {
    alignSelf: 'flex-start',
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    borderColor: theme.colors.accent.primary,
    backgroundColor: theme.colors.accent.soft,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 5,
    marginTop: 2,
  },
  quickReplies: {
    marginBottom: theme.spacing[1],
  },
  quickRepliesContent: {
    paddingHorizontal: 0,
  },
  quickRepliesLabel: {
    marginTop: -2,
    marginBottom: theme.spacing[1] - 2,
    paddingHorizontal: theme.spacing[1],
  },
});

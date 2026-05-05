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
  ModeButton,
  ModeChip,
  ModeInput,
  ModeText,
  SafeScreen,
  GlassSurface,
  HeroOverlayCard,
  SystemActionSheet,
} from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import { BREATHING_TRANSITIONS_ENABLED } from '../../../config/featureFlags';
import { BREATHING_CONTEXT, BreathingTransitionOverlay } from '../../shared/loading';
import {
  createTrainerClientMemory,
  listTrainerClients,
  updateTrainerClientMemory,
} from '../../trainerClients/services/trainerHomeApi';
import {
  loadCoachChatLastMemoryClientId,
  saveCoachChatLastMemoryClientId,
} from '../storage/chatMemoryStorage';
import ChatBubble from '../components/ChatBubble';
import CoachComposer from '../components/CoachComposer';
import QuickReplies from '../components/QuickReplies';
import TypingIndicator from '../components/TypingIndicator';
import { useChatConversation } from '../hooks/useChatConversation';

const KEYBOARD_OPEN_COMPOSER_OFFSET = theme.spacing[1];
const LIST_BOTTOM_BREATHING_ROOM = theme.spacing[2];
const COPY_FEEDBACK_TIMEOUT_MS = 2200;
const NEAR_BOTTOM_THRESHOLD_PX = 120;
const SAME_SENDER_MESSAGE_GAP = 5;
const DIFFERENT_SENDER_MESSAGE_GAP = 14;
const MEMORY_SUGGESTION_MIN_CONFIDENCE = 0.78;
const MEMORY_CAPTURE_TAG_OPTIONS = ['Goal', 'Injury', 'Preference', 'Constraint'];

const MEMORY_CAPTURE_PHASE = {
  IDLE: 'idle',
  SUGGESTED: 'suggested',
  SAVING: 'saving',
  SAVED: 'saved',
  EDITING: 'editing',
  DISMISSED: 'dismissed',
};

function parseMemoryVisibilityLabel(visibility) {
  return visibility === 'internal_only' ? 'Internal' : 'AI';
}

function normalizeMemoryVisibility(value) {
  return value === 'internal_only' ? 'internal_only' : 'ai_usable';
}

function parseClientIdFromLaunchContext(launchContext) {
  if (!launchContext || typeof launchContext !== 'object') {
    return null;
  }
  const candidateList = [
    launchContext.client_id,
    launchContext.clientId,
    launchContext?.checkin_context?.client_id,
    launchContext?.workout_context?.client_id,
    launchContext?.nutrition_context?.client_id,
  ];
  for (const candidate of candidateList) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}

function normalizeMemorySuggestion(rawSuggestion = {}) {
  const text = typeof rawSuggestion?.suggested_text === 'string'
    ? rawSuggestion.suggested_text.trim()
    : '';
  if (!text) {
    return null;
  }
  const confidenceValue = Number(rawSuggestion?.confidence);
  const confidence = Number.isFinite(confidenceValue)
    ? Math.max(0, Math.min(1, confidenceValue))
    : 0;
  if (confidence < MEMORY_SUGGESTION_MIN_CONFIDENCE) {
    return null;
  }
  const detectedCategory = typeof rawSuggestion?.detected_category === 'string'
    ? rawSuggestion.detected_category.trim().toLowerCase()
    : null;
  return {
    sourceMessageId: typeof rawSuggestion?.source_message_id === 'string'
      ? rawSuggestion.source_message_id
      : null,
    suggestedText: text,
    detectedCategory: detectedCategory || null,
    confidence,
    defaultVisibility: normalizeMemoryVisibility(rawSuggestion?.default_visibility),
    source: 'ai_detected',
  };
}

function buildMemorySuggestionHash(suggestion) {
  if (!suggestion) {
    return null;
  }
  return [
    suggestion.sourceMessageId || '',
    suggestion.suggestedText || '',
    suggestion.detectedCategory || '',
  ].join('|').toLowerCase();
}

function normalizeMessageRole(role) {
  if (role === 'user') {
    return 'user';
  }
  if (role === 'assistant') {
    return 'assistant';
  }
  return null;
}

function resolveMessageGroupPosition(previousRole, currentRole, nextRole) {
  if (!currentRole) {
    return 'single';
  }
  const sameAsPrevious = previousRole === currentRole;
  const sameAsNext = nextRole === currentRole;
  if (!sameAsPrevious && !sameAsNext) {
    return 'single';
  }
  if (!sameAsPrevious && sameAsNext) {
    return 'start';
  }
  if (sameAsPrevious && sameAsNext) {
    return 'middle';
  }
  return 'end';
}

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

function MemorySuggestionRow({
  visibility = 'ai_usable',
  onVisibilityChange,
  onSave,
  onDismiss,
  isSaving = false,
  error = null,
}) {
  return (
    <View style={styles.memorySuggestionRail}>
      <ModeText variant="caption" tone="secondary" style={styles.memorySuggestionLabel}>
        Save as memory?
      </ModeText>
      <View style={styles.memorySuggestionActions}>
        <ModeChip
          testID="coach-chat-memory-suggestion-ai"
          label="AI"
          selected={visibility === 'ai_usable'}
          onPress={() => onVisibilityChange?.('ai_usable')}
          disabled={isSaving}
        />
        <ModeChip
          testID="coach-chat-memory-suggestion-internal"
          label="Internal"
          selected={visibility === 'internal_only'}
          onPress={() => onVisibilityChange?.('internal_only')}
          disabled={isSaving}
        />
        <Pressable
          testID="coach-chat-memory-suggestion-save"
          accessibilityRole="button"
          accessibilityLabel={isSaving ? 'Saving memory' : 'Save memory'}
          onPress={onSave}
          disabled={isSaving}
          style={({ pressed }) => [
            styles.memorySaveButton,
            pressed && !isSaving && styles.memorySaveButtonPressed,
            isSaving && styles.memorySaveButtonDisabled,
          ]}
        >
          <ModeText variant="caption" tone="accent" style={styles.memorySaveButtonLabel}>
            {isSaving ? 'Saving…' : 'Save'}
          </ModeText>
        </Pressable>
        <Pressable
          testID="coach-chat-memory-suggestion-dismiss"
          accessibilityRole="button"
          accessibilityLabel="Dismiss memory suggestion"
          onPress={onDismiss}
          disabled={isSaving}
          style={({ pressed }) => [
            styles.memoryDismissButton,
            pressed && !isSaving && styles.memorySaveButtonPressed,
            isSaving && styles.memorySaveButtonDisabled,
          ]}
        >
          <ModeText variant="caption" tone="secondary">Dismiss</ModeText>
        </Pressable>
      </View>
      {error ? (
        <ModeText variant="caption" tone="error" style={styles.memoryRailFeedback}>
          {error}
        </ModeText>
      ) : null}
    </View>
  );
}

function MemorySavedRow({
  visibility = 'ai_usable',
  tags = [],
  onPress,
  onTagPress,
  isTagging = false,
  feedback = null,
}) {
  return (
    <View style={styles.memorySavedRail}>
      <Pressable
        testID="coach-chat-memory-saved-event"
        accessibilityRole="button"
        accessibilityLabel="Edit saved memory"
        onPress={onPress}
        style={({ pressed }) => [
          styles.memorySavedEvent,
          pressed && styles.memorySavedEventPressed,
        ]}
      >
        <ModeText variant="caption" tone="secondary" style={styles.memorySavedEventText}>
          {`Saved to memory • ${parseMemoryVisibilityLabel(visibility)}`}
        </ModeText>
      </Pressable>
      <View style={styles.memoryTagPromptRow}>
        <ModeText variant="caption" tone="tertiary">Add tag?</ModeText>
        <View style={styles.memoryTagChipsWrap}>
          {MEMORY_CAPTURE_TAG_OPTIONS.map((label) => {
            const normalizedLabel = label.toLowerCase();
            const alreadyTagged = tags.includes(normalizedLabel);
            return (
              <ModeChip
                key={label}
                testID={`coach-chat-memory-add-tag-${normalizedLabel}`}
                label={label}
                selected={alreadyTagged}
                onPress={() => onTagPress?.(normalizedLabel)}
                disabled={isTagging || alreadyTagged}
              />
            );
          })}
        </View>
      </View>
      {feedback ? (
        <ModeText variant="caption" tone="secondary" style={styles.memoryRailFeedback}>
          {feedback}
        </ModeText>
      ) : null}
    </View>
  );
}

function HistoryPaginationControl({
  hasMoreHistory = false,
  isLoading = false,
  error = null,
  onLoadMore,
}) {
  if (!hasMoreHistory && !error) {
    return null;
  }
  return (
    <View style={styles.historyPagination}>
      {hasMoreHistory ? (
        <Pressable
          testID="coach-chat-load-more-button"
          accessibilityRole="button"
          accessibilityLabel={isLoading ? 'Loading more messages' : 'Load more messages'}
          onPress={onLoadMore}
          disabled={isLoading}
          style={({ pressed }) => [
            styles.loadMoreButton,
            pressed && !isLoading && styles.loadMoreButtonPressed,
            isLoading && styles.loadMoreButtonDisabled,
          ]}
        >
          <ModeText variant="caption" tone="accent" style={styles.loadMoreButtonText}>
            Load more
          </ModeText>
        </Pressable>
      ) : null}
      {error ? (
        <ModeText
          testID="coach-chat-load-more-error"
          variant="caption"
          tone="error"
          style={styles.loadMoreError}
        >
          {error}
        </ModeText>
      ) : null}
    </View>
  );
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
  const [memoryCapture, setMemoryCapture] = useState({
    phase: MEMORY_CAPTURE_PHASE.IDLE,
    anchorMessageId: null,
    text: '',
    visibility: 'ai_usable',
    source: 'explicit',
    detectedCategory: null,
    confidence: null,
    error: null,
    memoryId: null,
    tags: [],
    clientId: null,
  });
  const [memorySavedFeedback, setMemorySavedFeedback] = useState(null);
  const [isMemoryTagSaving, setIsMemoryTagSaving] = useState(false);
  const [isMemoryEditVisible, setIsMemoryEditVisible] = useState(false);
  const [memoryEditText, setMemoryEditText] = useState('');
  const [memoryEditVisibility, setMemoryEditVisibility] = useState('ai_usable');
  const [memoryEditError, setMemoryEditError] = useState(null);
  const [isMemoryEditSaving, setIsMemoryEditSaving] = useState(false);
  const [memoryClientPickerVisible, setMemoryClientPickerVisible] = useState(false);
  const [memoryClientOptions, setMemoryClientOptions] = useState([]);
  const [isMemoryClientLoading, setIsMemoryClientLoading] = useState(false);
  const [memoryClientError, setMemoryClientError] = useState(null);
  const [selectedMemoryClientId, setSelectedMemoryClientId] = useState(null);
  const [pendingMemorySave, setPendingMemorySave] = useState(null);
  const listRef = useRef(null);
  const pendingScrollRef = useRef(false);
  const pendingHistoryPrependRef = useRef(null);
  const copyFeedbackTimerRef = useRef(null);
  const scrollTimeoutsRef = useRef([]);
  const seenMemorySuggestionHashesRef = useRef(new Set());
  const scrollMetricsRef = useRef({
    offset: 0,
    contentHeight: 0,
    layoutHeight: 0,
    nearBottom: true,
  });
  const keyboardOffsetShiftRef = useRef(0);
  const dockAnchorInset = Math.max(bottomInset, 0);
  const activeComposerOffset = isKeyboardVisible
    ? KEYBOARD_OPEN_COMPOSER_OFFSET
    : dockAnchorInset;
  const chatListPaddingBottom = dockHeight + activeComposerOffset + LIST_BOTTOM_BREATHING_ROOM;
  const previousChatListPaddingBottomRef = useRef(chatListPaddingBottom);
  const sessionIntro = useMemo(() => resolveSessionIntro(launchContext), [launchContext]);
  const activeLaunchClientId = useMemo(
    () => parseClientIdFromLaunchContext(launchContext),
    [launchContext],
  );
  const resolvedMemoryClientId = activeLaunchClientId || selectedMemoryClientId;
  const backAccessibilityLabel =
    launchContext?.entrypoint === 'generated_nutrition'
      ? 'Back to generated nutrition plan'
      : 'Back to generated workout';

  const {
    messages,
    quickReplies,
    isSending,
    isConversationInitializing,
    error,
    errorDetails,
    hasRetryableFailure,
    hasMoreHistory,
    isLoadingMoreHistory,
    historyPaginationError,
    loadMoreHistory,
    sendMessage,
    cancelActiveResponse,
    retryFailedRequest,
  } = useChatConversation(accessToken, launchContext);
  const breathingTransitionsEnabled = Boolean(BREATHING_TRANSITIONS_ENABLED);
  const shouldDisableComposer = isSending || isConversationInitializing;

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
      const listHandle = listRef.current;
      if (listHandle?.scrollToEnd) {
        listHandle.scrollToEnd({ animated });
        if (listHandle?.scrollToOffset) {
          listHandle.scrollToOffset({ offset: maxOffset, animated: false });
        }
        updateScrollMetrics({ offset: maxOffset });
        return;
      }
      if (listHandle?.scrollToOffset) {
        listHandle.scrollToOffset({ offset: maxOffset, animated });
      }
      updateScrollMetrics({ offset: maxOffset });
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

  const handleLoadMoreHistory = useCallback(async () => {
    if (!hasMoreHistory || isLoadingMoreHistory) {
      return;
    }
    const metrics = scrollMetricsRef.current;
    pendingHistoryPrependRef.current = {
      contentHeight: metrics.contentHeight,
      offset: metrics.offset,
    };
    const didPrepend = await loadMoreHistory();
    if (!didPrepend) {
      pendingHistoryPrependRef.current = null;
    }
  }, [hasMoreHistory, isLoadingMoreHistory, loadMoreHistory]);

  const handleComposerFocus = useCallback(() => {
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

  const resetMemoryCapture = useCallback(() => {
    setMemoryCapture({
      phase: MEMORY_CAPTURE_PHASE.IDLE,
      anchorMessageId: null,
      text: '',
      visibility: 'ai_usable',
      source: 'explicit',
      detectedCategory: null,
      confidence: null,
      error: null,
      memoryId: null,
      tags: [],
      clientId: null,
    });
    setMemorySavedFeedback(null);
  }, []);

  const dismissMemoryCaptureOnNextMessage = useCallback(() => {
    setMemoryCapture((current) => {
      if (
        current.phase !== MEMORY_CAPTURE_PHASE.SUGGESTED
        && current.phase !== MEMORY_CAPTURE_PHASE.SAVING
        && current.phase !== MEMORY_CAPTURE_PHASE.SAVED
      ) {
        return current;
      }
      return {
        ...current,
        phase: MEMORY_CAPTURE_PHASE.DISMISSED,
        anchorMessageId: null,
        error: null,
      };
    });
    setMemorySavedFeedback(null);
  }, []);

  const suggestMemoryForMessage = useCallback(({
    anchorMessageId,
    suggestedText,
    source = 'explicit',
    detectedCategory = null,
    confidence = null,
    defaultVisibility = 'ai_usable',
  }) => {
    const trimmedText = String(suggestedText || '').trim();
    if (!trimmedText || !anchorMessageId) {
      return;
    }
    setMemoryCapture({
      phase: MEMORY_CAPTURE_PHASE.SUGGESTED,
      anchorMessageId,
      text: trimmedText,
      visibility: normalizeMemoryVisibility(defaultVisibility),
      source,
      detectedCategory,
      confidence: Number.isFinite(Number(confidence)) ? Number(confidence) : null,
      error: null,
      memoryId: null,
      tags: [],
      clientId: resolvedMemoryClientId,
    });
    setMemorySavedFeedback(null);
  }, [resolvedMemoryClientId]);

  const loadMemoryClients = useCallback(async () => {
    if (!accessToken || isMemoryClientLoading) {
      return;
    }
    setIsMemoryClientLoading(true);
    setMemoryClientError(null);
    try {
      const payload = await listTrainerClients({ accessToken, limit: 50, offset: 0 });
      const options = Array.isArray(payload?.items)
        ? payload.items
        : (Array.isArray(payload) ? payload : []);
      setMemoryClientOptions(options);
      if (options.length === 0) {
        setMemoryClientError('No clients available to save memory.');
      }
    } catch (nextError) {
      setMemoryClientError(nextError?.message || 'Unable to load clients.');
    } finally {
      setIsMemoryClientLoading(false);
    }
  }, [accessToken, isMemoryClientLoading]);

  const persistMemoryCapture = useCallback(async ({
    text,
    visibility,
    anchorMessageId,
    source,
    detectedCategory,
    confidence,
    clientIdOverride = null,
  }) => {
    const trimmedText = String(text || '').trim();
    if (!trimmedText) {
      setMemoryCapture((current) => ({
        ...current,
        phase: MEMORY_CAPTURE_PHASE.SUGGESTED,
        error: 'Add memory text before saving.',
      }));
      return { saved: false, deferred: false };
    }

    const targetClientId = clientIdOverride || resolvedMemoryClientId;
    if (!targetClientId) {
      setPendingMemorySave({
        text: trimmedText,
        visibility: normalizeMemoryVisibility(visibility),
        anchorMessageId,
        source,
        detectedCategory,
        confidence,
      });
      setMemoryClientPickerVisible(true);
      await loadMemoryClients();
      setMemoryCapture((current) => ({
        ...current,
        phase: MEMORY_CAPTURE_PHASE.SUGGESTED,
        error: null,
      }));
      return { saved: false, deferred: true };
    }

    try {
      const created = await createTrainerClientMemory({
        accessToken,
        clientId: targetClientId,
        memoryType: 'note',
        text: trimmedText,
        visibility: normalizeMemoryVisibility(visibility),
        tags: [],
        structuredData: {
          capture_source: source || 'explicit',
          detected_category: detectedCategory || null,
          confidence: Number.isFinite(Number(confidence)) ? Number(confidence) : null,
          source_message_id: anchorMessageId || null,
          channel: 'coach_chat',
        },
      });
      const createdTags = Array.isArray(created?.tags)
        ? created.tags.map((tag) => String(tag || '').trim().toLowerCase()).filter(Boolean)
        : [];
      setMemoryCapture({
        phase: MEMORY_CAPTURE_PHASE.SAVED,
        anchorMessageId,
        text: trimmedText,
        visibility: normalizeMemoryVisibility(created?.visibility || visibility),
        source: source || 'explicit',
        detectedCategory: detectedCategory || null,
        confidence: Number.isFinite(Number(confidence)) ? Number(confidence) : null,
        error: null,
        memoryId: created?.id || null,
        tags: createdTags,
        clientId: targetClientId,
      });
      await saveCoachChatLastMemoryClientId(targetClientId);
      setSelectedMemoryClientId(targetClientId);
      setMemorySavedFeedback('Saved to memory.');
      return { saved: true, deferred: false };
    } catch (nextError) {
      setMemoryCapture((current) => ({
        ...current,
        phase: MEMORY_CAPTURE_PHASE.SUGGESTED,
        error: nextError?.message || 'Unable to save memory.',
      }));
      return { saved: false, deferred: false };
    }
  }, [accessToken, loadMemoryClients, resolvedMemoryClientId]);

  const handleSaveMemorySuggestion = useCallback(async () => {
    const activeSuggestion = memoryCapture;
    if (
      activeSuggestion.phase !== MEMORY_CAPTURE_PHASE.SUGGESTED
      && activeSuggestion.phase !== MEMORY_CAPTURE_PHASE.SAVING
    ) {
      return;
    }
    setMemoryCapture((current) => ({
      ...current,
      phase: MEMORY_CAPTURE_PHASE.SAVING,
      error: null,
    }));
    await persistMemoryCapture({
      text: activeSuggestion.text,
      visibility: activeSuggestion.visibility,
      anchorMessageId: activeSuggestion.anchorMessageId,
      source: activeSuggestion.source,
      detectedCategory: activeSuggestion.detectedCategory,
      confidence: activeSuggestion.confidence,
    });
  }, [memoryCapture, persistMemoryCapture]);

  const handleMemoryTagPress = useCallback(async (tagLabel) => {
    if (!tagLabel || isMemoryTagSaving) {
      return;
    }
    const memoryId = memoryCapture?.memoryId;
    const clientId = memoryCapture?.clientId || resolvedMemoryClientId;
    if (!accessToken || !clientId || !memoryId) {
      return;
    }
    const normalizedTag = String(tagLabel).trim().toLowerCase();
    if (!normalizedTag) {
      return;
    }
    const existingTags = Array.isArray(memoryCapture?.tags) ? memoryCapture.tags : [];
    if (existingTags.includes(normalizedTag)) {
      return;
    }
    setIsMemoryTagSaving(true);
    setMemorySavedFeedback(null);
    try {
      await updateTrainerClientMemory({
        accessToken,
        clientId,
        memoryId,
        tags: [...existingTags, normalizedTag],
      });
      setMemoryCapture((current) => ({
        ...current,
        tags: [...existingTags, normalizedTag],
      }));
      setMemorySavedFeedback(`Tag added: ${normalizedTag}`);
    } catch (nextError) {
      setMemorySavedFeedback(nextError?.message || 'Unable to add tag.');
    } finally {
      setIsMemoryTagSaving(false);
    }
  }, [accessToken, isMemoryTagSaving, memoryCapture, resolvedMemoryClientId]);

  const openMemoryEditSheet = useCallback(() => {
    if (memoryCapture.phase !== MEMORY_CAPTURE_PHASE.SAVED || !memoryCapture.memoryId) {
      return;
    }
    setMemoryEditText(memoryCapture.text || '');
    setMemoryEditVisibility(memoryCapture.visibility || 'ai_usable');
    setMemoryEditError(null);
    setMemoryCapture((current) => ({
      ...current,
      phase: MEMORY_CAPTURE_PHASE.EDITING,
    }));
    setIsMemoryEditVisible(true);
  }, [memoryCapture]);

  const closeMemoryEditSheet = useCallback(() => {
    setIsMemoryEditVisible(false);
    setMemoryEditError(null);
    setMemoryCapture((current) => (
      current.phase === MEMORY_CAPTURE_PHASE.EDITING
        ? { ...current, phase: MEMORY_CAPTURE_PHASE.SAVED }
        : current
    ));
  }, []);

  const handleSaveMemoryEdit = useCallback(async () => {
    const memoryId = memoryCapture?.memoryId;
    const clientId = memoryCapture?.clientId || resolvedMemoryClientId;
    const trimmedText = String(memoryEditText || '').trim();
    if (!accessToken || !clientId || !memoryId) {
      setMemoryEditError('Select a client before saving.');
      return;
    }
    if (!trimmedText) {
      setMemoryEditError('Memory text cannot be empty.');
      return;
    }

    setIsMemoryEditSaving(true);
    setMemoryEditError(null);
    try {
      await updateTrainerClientMemory({
        accessToken,
        clientId,
        memoryId,
        text: trimmedText,
        visibility: normalizeMemoryVisibility(memoryEditVisibility),
      });
      setMemoryCapture((current) => ({
        ...current,
        phase: MEMORY_CAPTURE_PHASE.SAVED,
        text: trimmedText,
        visibility: normalizeMemoryVisibility(memoryEditVisibility),
        error: null,
      }));
      setMemorySavedFeedback('Memory updated.');
      setIsMemoryEditVisible(false);
    } catch (nextError) {
      setMemoryEditError(nextError?.message || 'Unable to update memory.');
    } finally {
      setIsMemoryEditSaving(false);
    }
  }, [accessToken, memoryCapture, memoryEditText, memoryEditVisibility, resolvedMemoryClientId]);

  const handleSaveMemoryCommand = useCallback(async (commandText) => {
    const trimmedText = String(commandText || '').trim();
    if (!trimmedText) {
      showCopyFeedback('Use /mem <text> to save memory.');
      return false;
    }
    const anchorMessageId = messages[messages.length - 1]?.id || null;
    if (!anchorMessageId) {
      showCopyFeedback('Unable to anchor memory right now.');
      return false;
    }
    setMemoryCapture({
      phase: MEMORY_CAPTURE_PHASE.SAVING,
      anchorMessageId,
      text: trimmedText,
      visibility: 'ai_usable',
      source: 'explicit',
      detectedCategory: null,
      confidence: null,
      error: null,
      memoryId: null,
      tags: [],
      clientId: resolvedMemoryClientId,
    });
    const result = await persistMemoryCapture({
      text: trimmedText,
      visibility: 'ai_usable',
      anchorMessageId,
      source: 'explicit',
      detectedCategory: null,
      confidence: null,
    });
    return result.saved || result.deferred;
  }, [messages, persistMemoryCapture, resolvedMemoryClientId, showCopyFeedback]);

  const handleSend = async () => {
    const message = draft.trim();
    if (!message) {
      return;
    }
    if (message.toLowerCase().startsWith('/mem')) {
      const memoryText = message.replace(/^\/mem\b/i, '').trim();
      queueAutoScroll();
      const handled = await handleSaveMemoryCommand(memoryText);
      if (handled) {
        setDraft('');
        scrollToLatestWithRetries(true);
      }
      return;
    }
    dismissMemoryCaptureOnNextMessage();
    queueAutoScroll();
    const sent = await sendMessage(message);
    if (sent) {
      setDraft('');
      scrollToLatestWithRetries(true);
    }
  };

  const handleQuickReply = async (reply) => {
    dismissMemoryCaptureOnNextMessage();
    queueAutoScroll();
    const sent = await sendMessage(reply);
    if (sent) {
      setDraft('');
      scrollToLatestWithRetries(true);
    }
  };

  const handleRetryLastMessage = async () => {
    dismissMemoryCaptureOnNextMessage();
    queueAutoScroll();
    const sent = await retryFailedRequest();
    if (sent) {
      setDraft('');
      scrollToLatestWithRetries(true);
    }
  };

  const handleChecklistCommand = async (command) => {
    dismissMemoryCaptureOnNextMessage();
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

  const handleMessageLongPress = useCallback((item) => {
    if (!item?.id || typeof item?.text !== 'string') {
      return;
    }
    if (item?.kind === 'assistant_progress' || item?.kind === 'assistant_stream') {
      return;
    }
    suggestMemoryForMessage({
      anchorMessageId: item.id,
      suggestedText: item.text,
      source: 'explicit',
      detectedCategory: null,
      confidence: null,
      defaultVisibility: 'ai_usable',
    });
  }, [suggestMemoryForMessage]);

  const handleSelectMemoryClient = useCallback(async (clientId) => {
    const normalizedClientId = typeof clientId === 'string' ? clientId.trim() : '';
    if (!normalizedClientId) {
      return;
    }
    setSelectedMemoryClientId(normalizedClientId);
    await saveCoachChatLastMemoryClientId(normalizedClientId);
    setMemoryClientPickerVisible(false);
    setMemoryClientError(null);
    const pendingPayload = pendingMemorySave;
    setPendingMemorySave(null);
    if (!pendingPayload) {
      return;
    }
    setMemoryCapture((current) => ({
      ...current,
      phase: MEMORY_CAPTURE_PHASE.SAVING,
      clientId: normalizedClientId,
      error: null,
    }));
    await persistMemoryCapture({
      ...pendingPayload,
      clientIdOverride: normalizedClientId,
    });
  }, [pendingMemorySave, persistMemoryCapture]);

  const closeMemoryClientPicker = useCallback(() => {
    setMemoryClientPickerVisible(false);
    setPendingMemorySave(null);
    setMemoryClientError(null);
    setMemoryCapture((current) => (
      current.phase === MEMORY_CAPTURE_PHASE.SAVING
        ? { ...current, phase: MEMORY_CAPTURE_PHASE.SUGGESTED }
        : current
    ));
  }, []);

  useEffect(() => {
    let active = true;
    loadCoachChatLastMemoryClientId().then((clientId) => {
      if (!active || !clientId) {
        return;
      }
      setSelectedMemoryClientId(clientId);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!activeLaunchClientId) {
      return;
    }
    setSelectedMemoryClientId(activeLaunchClientId);
    saveCoachChatLastMemoryClientId(activeLaunchClientId);
  }, [activeLaunchClientId]);

  useEffect(() => {
    if (
      memoryCapture.phase !== MEMORY_CAPTURE_PHASE.IDLE
      && memoryCapture.phase !== MEMORY_CAPTURE_PHASE.DISMISSED
    ) {
      return;
    }
    const knownMessageIds = new Set(messages.map((message) => message?.id).filter(Boolean));
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const candidateMessage = messages[index];
      if (candidateMessage?.role !== 'assistant' || !Array.isArray(candidateMessage?.memorySuggestions)) {
        continue;
      }
      for (const rawSuggestion of candidateMessage.memorySuggestions) {
        const normalizedSuggestion = normalizeMemorySuggestion(rawSuggestion);
        if (!normalizedSuggestion) {
          continue;
        }
        const suggestionHash = buildMemorySuggestionHash(normalizedSuggestion);
        if (!suggestionHash || seenMemorySuggestionHashesRef.current.has(suggestionHash)) {
          continue;
        }
        seenMemorySuggestionHashesRef.current.add(suggestionHash);
        const resolvedAnchorId = (
          normalizedSuggestion.sourceMessageId
          && knownMessageIds.has(normalizedSuggestion.sourceMessageId)
        )
          ? normalizedSuggestion.sourceMessageId
          : candidateMessage.id;
        suggestMemoryForMessage({
          anchorMessageId: resolvedAnchorId,
          suggestedText: normalizedSuggestion.suggestedText,
          source: normalizedSuggestion.source,
          detectedCategory: normalizedSuggestion.detectedCategory,
          confidence: normalizedSuggestion.confidence,
          defaultVisibility: normalizedSuggestion.defaultVisibility,
        });
        return;
      }
    }
  }, [memoryCapture.phase, messages, suggestMemoryForMessage]);

  useEffect(() => {
    scrollToLatest(false);
  }, [scrollToLatest]);

  useEffect(() => {
    const previousPadding = previousChatListPaddingBottomRef.current;
    previousChatListPaddingBottomRef.current = chatListPaddingBottom;
    if (chatListPaddingBottom <= previousPadding) {
      return;
    }
    if (messages.length <= 0 || !scrollMetricsRef.current.nearBottom) {
      return;
    }
    scrollToLatestWithRetries(false);
  }, [chatListPaddingBottom, messages.length, scrollToLatestWithRetries]);

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
    <SafeScreen
      includeBottomInset={false}
      includeTopInset={false}
      style={styles.screen}
      atmosphere="chat"
      atmosphereOverlayStrength={1.04}
    >
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
              const previousRole = index > 0 ? normalizeMessageRole(messages[index - 1]?.role) : null;
              const currentRole = normalizeMessageRole(item?.role);
              const nextRole = index < messages.length - 1
                ? normalizeMessageRole(messages[index + 1]?.role)
                : null;
              const showSpeakerLabel = previousRole !== currentRole;
              const groupPosition = resolveMessageGroupPosition(previousRole, currentRole, nextRole);
              const messageSpacing = nextRole === currentRole
                ? SAME_SENDER_MESSAGE_GAP
                : DIFFERENT_SENDER_MESSAGE_GAP;
              if (item?.kind === 'assistant_progress') {
                return (
                  <View style={[styles.messageItem, { marginBottom: messageSpacing }]}>
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
              const isMemoryAnchorMessage = memoryCapture.anchorMessageId === item?.id;
              const showMemorySuggestion = (
                isMemoryAnchorMessage
                && (
                  memoryCapture.phase === MEMORY_CAPTURE_PHASE.SUGGESTED
                  || memoryCapture.phase === MEMORY_CAPTURE_PHASE.SAVING
                )
              );
              const showMemorySaved = (
                isMemoryAnchorMessage
                && memoryCapture.phase === MEMORY_CAPTURE_PHASE.SAVED
              );
              return (
                <View style={[styles.messageItem, { marginBottom: messageSpacing }]}>
                  <Pressable
                    onLongPress={() => handleMessageLongPress(item)}
                    delayLongPress={220}
                    style={styles.chatBubblePressable}
                    accessibilityRole="button"
                    accessibilityLabel="Open message actions"
                    testID={`coach-chat-message-longpress-${item?.id || index}`}
                  >
                    <ChatBubble
                      role={item.role}
                      text={item.text}
                      isError={item.isError}
                      fallbackTriggered={item.fallbackTriggered}
                      showSpeakerLabel={showSpeakerLabel}
                      groupPosition={groupPosition}
                      messageKind={item?.kind || null}
                    />
                  </Pressable>
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
                  {showMemorySuggestion ? (
                    <MemorySuggestionRow
                      visibility={memoryCapture.visibility}
                      isSaving={memoryCapture.phase === MEMORY_CAPTURE_PHASE.SAVING}
                      error={memoryCapture.error}
                      onVisibilityChange={(visibility) => {
                        setMemoryCapture((current) => ({
                          ...current,
                          visibility: normalizeMemoryVisibility(visibility),
                        }));
                      }}
                      onSave={handleSaveMemorySuggestion}
                      onDismiss={resetMemoryCapture}
                    />
                  ) : null}
                  {showMemorySaved ? (
                    <MemorySavedRow
                      visibility={memoryCapture.visibility}
                      tags={memoryCapture.tags}
                      onPress={openMemoryEditSheet}
                      onTagPress={handleMemoryTagPress}
                      isTagging={isMemoryTagSaving}
                      feedback={memorySavedFeedback}
                    />
                  ) : null}
                </View>
              );
            }}
            style={styles.messagesList}
            contentContainerStyle={[
              styles.messages,
              { paddingBottom: chatListPaddingBottom },
            ]}
            ListHeaderComponent={(
              <View>
                <HeroOverlayCard
                  eyebrow={sessionIntro.eyebrow}
                  title={sessionIntro.title}
                  body={sessionIntro.body}
                  style={styles.sessionIntroCard}
                  testID="coach-chat-session-intro"
                />
                <HistoryPaginationControl
                  hasMoreHistory={hasMoreHistory}
                  isLoading={isLoadingMoreHistory}
                  error={historyPaginationError}
                  onLoadMore={handleLoadMoreHistory}
                />
              </View>
            )}
            ListFooterComponent={<View style={styles.threadSpacer} />}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            showsVerticalScrollIndicator={false}
            scrollEventThrottle={16}
            initialNumToRender={14}
            maxToRenderPerBatch={8}
            updateCellsBatchingPeriod={50}
            windowSize={7}
            removeClippedSubviews={Platform.OS !== 'web'}
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
              const pendingHistoryPrepend = pendingHistoryPrependRef.current;
              updateScrollMetrics({ contentHeight: height });
              if (pendingHistoryPrepend) {
                pendingHistoryPrependRef.current = null;
                const heightDelta = Math.max(height - pendingHistoryPrepend.contentHeight, 0);
                scrollToOffset(pendingHistoryPrepend.offset + heightDelta, false);
                return;
              }
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

          <View
            pointerEvents="box-none"
            style={[
              styles.dock,
              {
                bottom: activeComposerOffset,
              },
            ]}
          >
            <View
              testID="coach-chat-dock-stack"
              onLayout={(event) => {
                const nextHeight = asNonNegativeNumber(event?.nativeEvent?.layout?.height, 0);
                setDockHeight((current) => (current === nextHeight ? current : nextHeight));
              }}
              style={styles.dockStack}
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
                      disabled={shouldDisableComposer}
                      style={({ pressed }) => [
                        styles.retryButton,
                        pressed && !shouldDisableComposer && styles.retryButtonPressed,
                        shouldDisableComposer && styles.retryButtonMuted,
                      ]}
                    >
                      <ModeText variant="label" tone="accent">
                        {shouldDisableComposer ? 'Retrying...' : 'Retry'}
                      </ModeText>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      testID="coach-chat-copy-error-button"
                      onPress={handleCopyError}
                      disabled={shouldDisableComposer}
                      style={({ pressed }) => [
                        styles.retryButton,
                        pressed && !shouldDisableComposer && styles.retryButtonPressed,
                        shouldDisableComposer && styles.retryButtonMuted,
                      ]}
                    >
                      <ModeText variant="label" tone="secondary">Copy error</ModeText>
                    </Pressable>
                  </View>
                </GlassSurface>
              ) : null}

              <QuickReplies
                replies={quickReplies}
                disabled={shouldDisableComposer}
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
                onCancel={cancelActiveResponse}
                isSending={isSending}
                onFocus={handleComposerFocus}
                disabled={shouldDisableComposer}
              />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
      <SystemActionSheet
        visible={memoryClientPickerVisible}
        onClose={closeMemoryClientPicker}
        testID="coach-chat-memory-client-picker-sheet"
      >
        <View style={styles.memorySheetContent}>
          <ModeText variant="label" tone="tertiary">Choose Client</ModeText>
          <ModeText variant="caption" tone="secondary">
            Select a client before saving this memory.
          </ModeText>
          {isMemoryClientLoading ? (
            <ModeText variant="caption" tone="secondary">Loading clients…</ModeText>
          ) : null}
          {!isMemoryClientLoading && memoryClientOptions.length === 0 ? (
            <ModeText variant="caption" tone="secondary">No clients available.</ModeText>
          ) : null}
          <View style={styles.memoryClientList}>
            {memoryClientOptions.map((client) => {
              const clientOptionId = client?.client_id || client?.id;
              const clientName = client?.client_name || client?.name || clientOptionId || 'Client';
              if (!clientOptionId) {
                return null;
              }
              return (
                <Pressable
                  key={clientOptionId}
                  testID={`coach-chat-memory-client-option-${clientOptionId}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Select ${clientName}`}
                  onPress={() => handleSelectMemoryClient(clientOptionId)}
                  style={({ pressed }) => [
                    styles.memoryClientOption,
                    pressed && styles.memoryClientOptionPressed,
                  ]}
                >
                  <ModeText variant="bodySm">{clientName}</ModeText>
                </Pressable>
              );
            })}
          </View>
          {memoryClientError ? (
            <ModeText variant="caption" tone="error">{memoryClientError}</ModeText>
          ) : null}
          <View style={styles.memorySheetButtons}>
            <ModeButton
              testID="coach-chat-memory-client-refresh"
              title="Refresh"
              variant="ghost"
              size="sm"
              onPress={loadMemoryClients}
            />
            <ModeButton
              testID="coach-chat-memory-client-cancel"
              title="Cancel"
              variant="ghost"
              size="sm"
              onPress={closeMemoryClientPicker}
            />
          </View>
        </View>
      </SystemActionSheet>
      <SystemActionSheet
        visible={isMemoryEditVisible}
        onClose={closeMemoryEditSheet}
        testID="coach-chat-memory-edit-sheet"
      >
        <View style={styles.memorySheetContent}>
          <ModeText variant="label" tone="tertiary">Edit Memory</ModeText>
          <ModeInput
            testID="coach-chat-memory-edit-input"
            value={memoryEditText}
            onChangeText={setMemoryEditText}
            placeholder="Update memory"
            style={styles.memoryEditInput}
          />
          <View style={styles.memoryEditVisibilityRow}>
            <ModeChip
              testID="coach-chat-memory-edit-ai-toggle"
              label="AI"
              selected={memoryEditVisibility === 'ai_usable'}
              onPress={() => setMemoryEditVisibility('ai_usable')}
              disabled={isMemoryEditSaving}
            />
            <ModeChip
              testID="coach-chat-memory-edit-internal-toggle"
              label="Internal"
              selected={memoryEditVisibility === 'internal_only'}
              onPress={() => setMemoryEditVisibility('internal_only')}
              disabled={isMemoryEditSaving}
            />
          </View>
          {memoryEditError ? (
            <ModeText variant="caption" tone="error">{memoryEditError}</ModeText>
          ) : null}
          <View style={styles.memorySheetButtons}>
            <ModeButton
              testID="coach-chat-memory-edit-cancel"
              title="Cancel"
              variant="ghost"
              size="sm"
              disabled={isMemoryEditSaving}
              onPress={closeMemoryEditSheet}
            />
            <ModeButton
              testID="coach-chat-memory-edit-save"
              title={isMemoryEditSaving ? 'Saving…' : 'Save'}
              size="sm"
              disabled={isMemoryEditSaving}
              onPress={handleSaveMemoryEdit}
            />
          </View>
        </View>
      </SystemActionSheet>
      {breathingTransitionsEnabled ? (
        <BreathingTransitionOverlay
          active={isConversationInitializing}
          context={BREATHING_CONTEXT.COACH_OPEN}
          variant="overlay"
          progressLabel="Opening your coach channel."
          testID="coach-chat-breathing-transition"
        />
      ) : null}
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
    ...theme.shadows.medium,
  },
  historyPagination: {
    alignItems: 'center',
    marginBottom: theme.spacing[2],
    gap: 6,
  },
  loadMoreButton: {
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    borderColor: 'rgba(182, 213, 255, 0.28)',
    backgroundColor: 'rgba(13, 24, 40, 0.72)',
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    overflow: 'hidden',
  },
  loadMoreButtonPressed: {
    opacity: theme.interaction.pressedOpacity,
    transform: [{ scale: theme.interaction.pressedScale }],
  },
  loadMoreButtonDisabled: {
    opacity: theme.interaction.disabledOpacity,
  },
  loadMoreButtonText: {
    fontWeight: '700',
  },
  loadMoreError: {
    textAlign: 'center',
  },
  messageItem: {
    width: '100%',
    marginBottom: 0,
  },
  chatBubblePressable: {
    width: '100%',
  },
  memorySuggestionRail: {
    alignSelf: 'flex-start',
    marginTop: 6,
    marginLeft: theme.spacing[1],
    width: '90%',
    borderRadius: theme.radii.m,
    borderWidth: 1,
    borderColor: 'rgba(218, 233, 255, 0.22)',
    backgroundColor: 'rgba(12, 23, 40, 0.72)',
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    gap: 6,
    overflow: 'hidden',
  },
  memorySuggestionLabel: {
    fontWeight: '600',
  },
  memorySuggestionActions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  memorySaveButton: {
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    borderColor: theme.colors.accent.primary,
    backgroundColor: 'rgba(79, 139, 237, 0.18)',
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 5,
    overflow: 'hidden',
  },
  memoryDismissButton: {
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    borderColor: 'rgba(215, 229, 252, 0.26)',
    backgroundColor: 'rgba(224, 237, 255, 0.10)',
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 5,
    overflow: 'hidden',
  },
  memorySaveButtonLabel: {
    fontWeight: '700',
  },
  memorySaveButtonPressed: {
    opacity: theme.interaction.pressedOpacity,
    transform: [{ scale: theme.interaction.pressedScale }],
  },
  memorySaveButtonDisabled: {
    opacity: theme.interaction.disabledOpacity,
  },
  memorySavedRail: {
    alignSelf: 'flex-start',
    marginTop: 6,
    marginLeft: theme.spacing[1],
    width: '90%',
    gap: 6,
  },
  memorySavedEvent: {
    alignSelf: 'flex-start',
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    borderColor: 'rgba(182, 213, 255, 0.28)',
    backgroundColor: 'rgba(13, 24, 40, 0.72)',
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 5,
    overflow: 'hidden',
  },
  memorySavedEventPressed: {
    opacity: theme.interaction.pressedOpacity,
    transform: [{ scale: theme.interaction.pressedScale }],
  },
  memorySavedEventText: {
    fontWeight: '600',
  },
  memoryTagPromptRow: {
    gap: 4,
  },
  memoryTagChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  memoryRailFeedback: {
    marginTop: 1,
  },
  threadSpacer: {
    height: theme.spacing[1],
  },
  dock: {
    position: 'absolute',
    left: theme.spacing[2],
    right: theme.spacing[2],
    zIndex: 3,
  },
  dockStack: {
    paddingTop: theme.spacing[1],
    gap: theme.spacing[1],
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
    backgroundColor: 'rgba(224, 237, 255, 0.11)',
    overflow: 'hidden',
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
    width: '86%',
    marginTop: 6,
    marginBottom: 0,
    marginLeft: theme.spacing[1],
    borderRadius: theme.radii.m,
    backgroundColor: 'rgba(20, 33, 55, 0.58)',
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    gap: 4,
    overflow: 'hidden',
  },
  previewScenario: {
    marginTop: 2,
  },
  previewResponse: {
    marginTop: 1,
  },
  checklistCard: {
    width: '90%',
    marginTop: 6,
    marginBottom: 0,
    marginLeft: theme.spacing[1],
    borderRadius: theme.radii.m,
    backgroundColor: 'rgba(19, 32, 54, 0.6)',
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    gap: theme.spacing[1],
    overflow: 'hidden',
  },
  checklistHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[1],
  },
  checklistItem: {
    borderRadius: theme.radii.s,
    backgroundColor: 'rgba(223, 236, 255, 0.09)',
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    gap: 6,
    overflow: 'hidden',
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
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 4,
    backgroundColor: 'rgba(224, 237, 255, 0.11)',
    overflow: 'hidden',
  },
  checklistApproveButton: {
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
    backgroundColor: theme.colors.accent.soft,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 5,
    marginTop: 2,
    overflow: 'hidden',
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
    color: theme.colors.text.secondary,
    fontWeight: '600',
  },
  memorySheetContent: {
    gap: theme.spacing[1],
    paddingTop: theme.spacing[1],
  },
  memoryClientList: {
    maxHeight: 240,
    gap: 6,
  },
  memoryClientOption: {
    borderRadius: theme.radii.m,
    borderWidth: 1,
    borderColor: 'rgba(214, 230, 255, 0.2)',
    backgroundColor: 'rgba(13, 24, 40, 0.68)',
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    overflow: 'hidden',
  },
  memoryClientOptionPressed: {
    opacity: theme.interaction.pressedOpacity,
  },
  memorySheetButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  memoryEditInput: {
    marginBottom: 0,
  },
  memoryEditVisibilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
});

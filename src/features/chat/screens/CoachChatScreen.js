import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  ModeButton,
  ModeChip,
  ModeInput,
  ModeText,
  SafeScreen,
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

const OPENING_LABEL_PATTERN = /^(Training|Nutrition|Mindset):\s*(.*)$/i;
const OPENING_QUESTION_PATTERN = /what do you want/i;

function parseOpeningSummary(text) {
  const lines = String(text || '').split(/\n/);
  const title = String(lines[0] || '').trim();
  const questionIndex = lines.findIndex((line) => OPENING_QUESTION_PATTERN.test(String(line || '')));
  const bodyLines = lines
    .slice(1, questionIndex >= 0 ? questionIndex : lines.length)
    .map((line) => String(line || '').trim())
    .filter(Boolean);
  const firstLabelIndex = bodyLines.findIndex((line) => OPENING_LABEL_PATTERN.test(line));
  const subtitle = firstLabelIndex > 0 || firstLabelIndex === -1
    ? bodyLines.slice(0, firstLabelIndex === -1 ? bodyLines.length : firstLabelIndex).join(' ')
    : '';
  const sectionLines = firstLabelIndex >= 0 ? bodyLines.slice(firstLabelIndex) : [];
  const question = questionIndex >= 0
    ? lines.slice(questionIndex).join(' ').trim()
    : '';
  return {
    title,
    subtitle,
    sections: sectionLines.map((line) => {
      const match = OPENING_LABEL_PATTERN.exec(line);
      if (!match) {
        return { label: null, body: line };
      }
      return {
        label: match[1][0].toUpperCase() + match[1].slice(1).toLowerCase(),
        body: String(match[2] || '').trim(),
      };
    }),
    question,
  };
}

function getModeColor(mode) {
  const key = typeof mode === 'string' ? mode.trim().toLowerCase() : '';
  return theme.colors.mode[key] || theme.colors.accent.primary;
}

function isOpeningAssistantMessage(item) {
  if (!item || item.role !== 'assistant') {
    return false;
  }
  if (typeof item.id === 'string' && item.id.startsWith('welcome')) {
    return true;
  }
  return item.kind === 'assistant_opening_summary';
}

const MEMORY_CAPTURE_PHASE = {
  IDLE: 'idle',
  SUGGESTED: 'suggested',
  SAVING: 'saving',
  SAVED: 'saved',
  EDITING: 'editing',
  DISMISSED: 'dismissed',
};

function CoachScreenHeader({
  trainerName = 'Your coach',
  isError = false,
  onBack = null,
}) {
  const insets = useSafeAreaInsets();
  const initial = typeof trainerName === 'string' && trainerName.length > 0
    ? trainerName.charAt(0).toUpperCase()
    : 'C';

  return (
    <View style={headerStyles.header} testID="chat-header">
      <View style={{ height: insets.top, backgroundColor: theme.colors.background.primary }} />
      <View style={headerStyles.row}>
        {onBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={onBack}
            style={({ pressed }) => [
              headerStyles.backButton,
              pressed && headerStyles.backButtonPressed,
            ]}
          >
            <Text style={headerStyles.backChevron}>‹</Text>
          </Pressable>
        ) : (
          <View style={headerStyles.backPlaceholder} />
        )}

        <View style={headerStyles.avatarWrap}>
          <LinearGradient
            colors={theme.colors.accent.gradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={headerStyles.avatar}
          >
            <Text style={headerStyles.avatarInitial}>{initial}</Text>
          </LinearGradient>
        </View>

        <View style={headerStyles.titleBlock}>
          <Text style={headerStyles.titleText} numberOfLines={1}>{trainerName}</Text>
          <View style={headerStyles.statusRow}>
            <View style={[
              headerStyles.statusDot,
              isError ? headerStyles.statusDotError : headerStyles.statusDotOnline,
            ]} />
            <Text style={[
              headerStyles.statusText,
              isError ? headerStyles.statusTextError : headerStyles.statusTextOnline,
            ]}>
              {isError ? 'not connected' : 'online'}
            </Text>
          </View>
        </View>

        <View style={headerStyles.rightSlot} />
      </View>
    </View>
  );
}

function OpeningMessageSequence({ item, launchContext }) {
  const checkinMode = typeof launchContext?.checkin_context?.assigned_mode === 'string'
    ? launchContext.checkin_context.assigned_mode.trim().toUpperCase()
    : null;
  const checkinScore = typeof launchContext?.checkin_context?.checkin_score === 'number'
    ? launchContext.checkin_context.checkin_score
    : null;
  const modeColor = checkinMode ? getModeColor(checkinMode) : null;
  const summary = parseOpeningSummary(item?.text || '');
  const hasSections = summary.sections.length > 0;
  const hasQuestion = Boolean(summary.question);

  const readinessText = summary.subtitle || (hasSections ? null : summary.title ? null : item.text);
  const bodyText = !hasSections && !summary.subtitle
    ? (summary.title || item.text)
    : null;

  return (
    <View style={openingStyles.container}>
      {checkinMode ? (
        <View style={openingStyles.modeBadgeWrap}>
          <View style={[openingStyles.modeBadge, { borderColor: `${modeColor}44` }]}>
            <View style={[openingStyles.modeDot, { backgroundColor: modeColor }]} />
            <Text style={[openingStyles.modeBadgeText, { color: modeColor }]}>
              {checkinMode} MODE{checkinScore !== null ? ` · ${checkinScore}/25` : ''}
            </Text>
          </View>
        </View>
      ) : null}

      {summary.title && hasSections ? (
        <View style={openingStyles.bubbleWrap}>
          <Text style={openingStyles.coachLabel}>COACH</Text>
          <View style={openingStyles.aiBubble}>
            <Text style={openingStyles.aiBubbleText}>{summary.title}</Text>
            {readinessText ? (
              <Text style={openingStyles.aiBubbleSubText}>{readinessText}</Text>
            ) : null}
          </View>
        </View>
      ) : null}

      {hasSections ? (
        <View style={openingStyles.bubbleWrap}>
          <View style={openingStyles.aiBubble}>
            {summary.sections.map((section, idx) => (
              <View key={`${section.label || 'line'}-${idx}`} style={openingStyles.sectionLine}>
                {section.label ? (
                  <Text style={openingStyles.sectionLabel}>{section.label}</Text>
                ) : null}
                <Text style={openingStyles.sectionBody}>
                  {section.label ? `  ${section.body}` : section.body}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {!hasSections && bodyText ? (
        <View style={openingStyles.bubbleWrap}>
          <Text style={openingStyles.coachLabel}>COACH</Text>
          <View style={openingStyles.aiBubble}>
            <Text style={openingStyles.aiBubbleText}>{bodyText}</Text>
          </View>
        </View>
      ) : null}

      {hasQuestion ? (
        <View style={[openingStyles.bubbleWrap, openingStyles.ctaBubbleWrap]}>
          <View style={openingStyles.ctaBubble}>
            <Text style={openingStyles.ctaBubbleText}>{summary.question}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function InlineBubbleUser({ text, showSpeakerLabel, groupPosition }) {
  const cornerStyle = resolveUserCorner(groupPosition);
  return (
    <View style={bubbleStyles.userRow}>
      {showSpeakerLabel ? (
        <Text style={bubbleStyles.userSpeakerLabel}>You</Text>
      ) : null}
      <LinearGradient
        colors={theme.colors.bubble.user.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[bubbleStyles.userBubble, cornerStyle]}
      >
        <Text style={bubbleStyles.userBubbleText}>{text}</Text>
      </LinearGradient>
    </View>
  );
}

function InlineBubbleAI({ text, showSpeakerLabel, groupPosition, isError }) {
  const cornerStyle = resolveAICorner(groupPosition);
  return (
    <View style={bubbleStyles.aiRow}>
      {showSpeakerLabel ? (
        <Text style={[bubbleStyles.coachLabel, isError && bubbleStyles.coachLabelError]}>
          {isError ? 'COACH' : 'COACH'}
        </Text>
      ) : null}
      <View style={[
        bubbleStyles.aiBubble,
        cornerStyle,
        isError && bubbleStyles.aiBubbleError,
      ]}>
        <Text style={[bubbleStyles.aiBubbleText, isError && bubbleStyles.aiBubbleTextError]}>
          {text}
        </Text>
      </View>
    </View>
  );
}

function resolveUserCorner(groupPosition) {
  switch (groupPosition) {
    case 'start': return bubbleStyles.userCornerStart;
    case 'middle': return bubbleStyles.userCornerMiddle;
    case 'end': return bubbleStyles.userCornerEnd;
    default: return bubbleStyles.userCornerSingle;
  }
}

function resolveAICorner(groupPosition) {
  switch (groupPosition) {
    case 'start': return bubbleStyles.aiCornerStart;
    case 'middle': return bubbleStyles.aiCornerMiddle;
    case 'end': return bubbleStyles.aiCornerEnd;
    default: return bubbleStyles.aiCornerSingle;
  }
}

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
  onTrainerOnboardingCompletePress = null,
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
  const [editingIndex, setEditingIndex] = useState(null);
  const [editDraft, setEditDraft] = useState('');
  const [isErrorBannerDismissed, setIsErrorBannerDismissed] = useState(false);
  const listRef = useRef(null);
  const pendingScrollRef = useRef(false);
  const pendingHistoryPrependRef = useRef(null);
  const copyFeedbackTimerRef = useRef(null);
  const errorBannerTimerRef = useRef(null);
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
  const activeLaunchClientId = useMemo(
    () => parseClientIdFromLaunchContext(launchContext),
    [launchContext],
  );
  const resolvedMemoryClientId = activeLaunchClientId || selectedMemoryClientId;

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

  const resolvedTrainerName = useMemo(() => {
    if (launchContext?.entrypoint === 'trainer_agent_training' && Array.isArray(messages)) {
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        const agentName = messages[i]?.profilePatch?.trainer_onboarding?.identity?.agent_name;
        if (typeof agentName === 'string' && agentName.trim().length > 0) {
          return agentName.trim();
        }
      }
    }
    const fromContext = launchContext?.trainer_name
      || launchContext?.trainerName
      || launchContext?.persona_name
      || launchContext?.personaName;
    if (typeof fromContext === 'string' && fromContext.trim().length > 0) {
      return fromContext.trim();
    }
    return 'Your coach';
  }, [launchContext, messages]);

  const isAwaitingTrainerEdit = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (m?.role === 'assistant') {
        return m?.profilePatch?.trainer_onboarding?.sample_review_state === 'awaiting_edit';
      }
    }
    return false;
  }, [messages]);

  const isTrainerOnboardingComplete = useMemo(() => {
    if (launchContext?.entrypoint !== 'trainer_agent_training') return false;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (m?.role === 'assistant') {
        return m?.profilePatch?.trainer_onboarding?.onboarding_status === 'completed';
      }
    }
    return false;
  }, [launchContext, messages]);

  const latestCalibrationMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (
        m?.role === 'assistant'
        && m?.profilePatch?.trainer_onboarding?.calibration_checklist
        && typeof m.profilePatch.trainer_onboarding.calibration_checklist === 'object'
      ) {
        return m.id;
      }
    }
    return null;
  }, [messages]);

  const effectiveQuickReplies = (latestCalibrationMessageId || isTrainerOnboardingComplete) ? [] : quickReplies;

  const breathingTransitionsEnabled = Boolean(BREATHING_TRANSITIONS_ENABLED);
  const shouldDisableComposer = isSending || isConversationInitializing;

  const [isActivating, setIsActivating] = useState(false);
  const glowOpacity = useRef(new Animated.Value(0.3)).current;
  const glowAnimationRef = useRef(null);

  useEffect(() => {
    if (isTrainerOnboardingComplete) {
      glowAnimationRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(glowOpacity, { toValue: 1, duration: 1400, useNativeDriver: true }),
          Animated.timing(glowOpacity, { toValue: 0.3, duration: 1400, useNativeDriver: true }),
        ]),
      );
      glowAnimationRef.current.start();
    }
    return () => {
      glowAnimationRef.current?.stop();
    };
  }, [isTrainerOnboardingComplete, glowOpacity]);

  const handleActivationPress = useCallback(async () => {
    if (!onTrainerOnboardingCompletePress || isActivating) return;
    setIsActivating(true);
    try {
      await onTrainerOnboardingCompletePress();
    } finally {
      setIsActivating(false);
    }
  }, [onTrainerOnboardingCompletePress, isActivating]);

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
    setEditingIndex(null);
    setEditDraft('');
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
    if (launchContext?.entrypoint === 'trainer_agent_training') {
      return;
    }
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
  }, [suggestMemoryForMessage, launchContext]);

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
    if (launchContext?.entrypoint === 'trainer_agent_training') {
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
  }, [memoryCapture.phase, messages, suggestMemoryForMessage, launchContext]);

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

  useEffect(() => {
    if (hasRetryableFailure) {
      setIsErrorBannerDismissed(false);
      if (errorBannerTimerRef.current) {
        clearTimeout(errorBannerTimerRef.current);
      }
      errorBannerTimerRef.current = setTimeout(() => {
        setIsErrorBannerDismissed(true);
        errorBannerTimerRef.current = null;
      }, 5000);
    } else {
      setIsErrorBannerDismissed(false);
      if (errorBannerTimerRef.current) {
        clearTimeout(errorBannerTimerRef.current);
        errorBannerTimerRef.current = null;
      }
    }
  }, [hasRetryableFailure]);

  useEffect(() => () => {
    if (copyFeedbackTimerRef.current) {
      clearTimeout(copyFeedbackTimerRef.current);
      copyFeedbackTimerRef.current = null;
    }
    if (errorBannerTimerRef.current) {
      clearTimeout(errorBannerTimerRef.current);
      errorBannerTimerRef.current = null;
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
      <View pointerEvents="none" style={styles.ambientGlowContainer}>
        <LinearGradient
          colors={['rgba(30,60,200,0.08)', 'rgba(30,60,200,0)']}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={styles.ambientGlow}
        />
      </View>
      <CoachScreenHeader
        trainerName={resolvedTrainerName}
        isError={hasRetryableFailure}
        onBack={onBack}
      />
      {hasRetryableFailure && !isErrorBannerDismissed ? (
        <View style={styles.notConnectedBar}>
          <ModeText variant="body3" style={styles.notConnectedText}>
            {error || 'Coach is unavailable right now'}
          </ModeText>
          {copyFeedback ? (
            <ModeText variant="body3" style={styles.notConnectedCopyFeedback}>
              {copyFeedback}
            </ModeText>
          ) : null}
          <Pressable
            onPress={handleRetryLastMessage}
            disabled={shouldDisableComposer}
            accessibilityRole="button"
            testID="coach-chat-retry-button"
            style={({ pressed }) => [
              styles.notConnectedRetry,
              pressed && styles.notConnectedRetryPressed,
            ]}
          >
            <ModeText variant="label" style={styles.notConnectedRetryText}>
              {shouldDisableComposer ? 'Retrying...' : 'Retry'}
            </ModeText>
          </Pressable>
          <Pressable
            onPress={handleCopyError}
            disabled={shouldDisableComposer}
            accessibilityRole="button"
            testID="coach-chat-copy-error-button"
            style={({ pressed }) => [
              styles.notConnectedRetry,
              pressed && styles.notConnectedRetryPressed,
            ]}
          >
            <ModeText variant="label" style={styles.notConnectedRetryText}>Copy error</ModeText>
          </Pressable>
          <Pressable
            onPress={() => setIsErrorBannerDismissed(true)}
            accessibilityRole="button"
            accessibilityLabel="Dismiss error"
            testID="coach-chat-error-dismiss-button"
            style={({ pressed }) => [
              styles.notConnectedRetry,
              pressed && styles.notConnectedRetryPressed,
            ]}
          >
            <ModeText variant="label" style={styles.notConnectedRetryText}>✕</ModeText>
          </Pressable>
        </View>
      ) : null}
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
              const isOpening = isOpeningAssistantMessage(item);
              const isLatestCalibration = Boolean(checklist) && item.id === latestCalibrationMessageId;
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
                    {isLatestCalibration ? null : isOpening ? (
                      <OpeningMessageSequence item={item} launchContext={launchContext} />
                    ) : item.role === 'user' ? (
                      <InlineBubbleUser
                        text={String(item.text || '')}
                        showSpeakerLabel={showSpeakerLabel}
                        groupPosition={groupPosition}
                      />
                    ) : (
                      <InlineBubbleAI
                        text={String(item.text || '')}
                        showSpeakerLabel={showSpeakerLabel}
                        groupPosition={groupPosition}
                        isError={Boolean(item.isError)}
                      />
                    )}
                    {item.fallbackTriggered ? (
                      <View style={[styles.fallbackTag, item.role === 'user' && styles.userFallbackTag]}>
                        <Text style={styles.fallbackTagText}>Flagged for trainer review</Text>
                      </View>
                    ) : null}
                  </Pressable>
                  {isLatestCalibration ? (
                    <View style={styles.checklistCard}>
                      <View style={styles.checklistHeader}>
                        <ModeText variant="label">Final calibration</ModeText>
                        <ModeText variant="caption" tone="tertiary">
                          {`${approvedCount} of ${totalCount} approved`}
                        </ModeText>
                      </View>
                      {samples.map((sample, idx) => {
                        const sampleIndex = Number.isFinite(Number(sample?.index))
                          ? Number(sample.index)
                          : (idx + 1);
                        const isApproved = String(sample?.status || '').toLowerCase() === 'approved';
                        const isActive = Boolean(sample?.is_active);
                        const isEditing = editingIndex === sampleIndex;
                        const cleanedScenario = String(sample?.scenario || '').replace(/^Client says:\s*/i, '').trim();
                        return (
                          <View
                            key={`${item.id}-sample-${sampleIndex}`}
                            style={[styles.checklistItem, isActive && styles.checklistItemActive]}
                          >
                            <ModeText variant="caption" tone="tertiary" style={styles.checklistSectionLabel}>
                              Scenario
                            </ModeText>
                            <ModeText variant="caption" tone="secondary" style={styles.checklistScenario}>
                              {cleanedScenario || 'Scenario'}
                            </ModeText>
                            <View style={styles.checklistDivider} />
                            <ModeText variant="caption" tone="tertiary" style={styles.checklistSectionLabel}>
                              How your coach responds
                            </ModeText>
                            {isEditing ? (
                              <View style={styles.checklistEditContainer}>
                                <TextInput
                                  testID={`coach-chat-checklist-edit-input-${sampleIndex}`}
                                  style={styles.checklistEditInput}
                                  value={editDraft}
                                  onChangeText={setEditDraft}
                                  placeholder={`Type your version for scenario ${sampleIndex}...`}
                                  placeholderTextColor="rgba(155,175,210,0.45)"
                                  multiline
                                  autoFocus
                                />
                                <Pressable
                                  accessibilityRole="button"
                                  testID={`coach-chat-checklist-edit-send-${sampleIndex}`}
                                  onPress={() => {
                                    const text = editDraft.trim();
                                    if (text) {
                                      handleChecklistCommand(`edit ${sampleIndex}: ${text}`);
                                    }
                                  }}
                                  disabled={isSending}
                                  style={({ pressed }) => [
                                    styles.checklistActionButton,
                                    styles.checklistApproveButton,
                                    pressed && !isSending && styles.checklistActionButtonPressed,
                                    isSending && styles.checklistActionButtonMuted,
                                  ]}
                                >
                                  <ModeText variant="caption" tone="accent">Send</ModeText>
                                </Pressable>
                              </View>
                            ) : (
                              <ModeText variant="bodySm" style={styles.checklistResponse}>
                                {sample?.response || ''}
                              </ModeText>
                            )}
                            {isApproved ? (
                              <View style={styles.checklistApprovedBadge}>
                                <ModeText variant="caption" tone="accent">Approved</ModeText>
                              </View>
                            ) : isActive && !isEditing ? (
                              <>
                                <ModeText variant="caption" tone="tertiary">
                                  {`${approvedCount} of ${totalCount} — reviewing ${sampleIndex}`}
                                </ModeText>
                                {sampleIndex === 1 && approvedCount === 0 ? (
                                  <ModeText variant="caption" tone="tertiary">
                                    Approve each response, edit it, or try again.
                                  </ModeText>
                                ) : null}
                                <View style={styles.checklistActions}>
                                  <Pressable
                                    accessibilityRole="button"
                                    testID={`coach-chat-checklist-approve-${sampleIndex}`}
                                    onPress={() => handleChecklistCommand(`approve ${sampleIndex}`)}
                                    disabled={isSending}
                                    style={({ pressed }) => [
                                      styles.checklistActionButton,
                                      styles.checklistApproveButton,
                                      pressed && !isSending && styles.checklistActionButtonPressed,
                                      isSending && styles.checklistActionButtonMuted,
                                    ]}
                                  >
                                    <ModeText variant="caption" tone="accent">Looks right</ModeText>
                                  </Pressable>
                                  <Pressable
                                    accessibilityRole="button"
                                    testID={`coach-chat-checklist-edit-${sampleIndex}`}
                                    onPress={() => {
                                      setEditingIndex(sampleIndex);
                                      setEditDraft(String(sample?.response || ''));
                                    }}
                                    disabled={isSending}
                                    style={({ pressed }) => [
                                      styles.checklistActionButton,
                                      pressed && !isSending && styles.checklistActionButtonPressed,
                                      isSending && styles.checklistActionButtonMuted,
                                    ]}
                                  >
                                    <ModeText variant="caption" tone="secondary">Edit</ModeText>
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
                                    <ModeText variant="caption" tone="secondary">Try again</ModeText>
                                  </Pressable>
                                </View>
                              </>
                            ) : null}
                          </View>
                        );
                      })}
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
              <QuickReplies
                replies={effectiveQuickReplies}
                disabled={shouldDisableComposer}
                onSelect={handleQuickReply}
                style={styles.quickReplies}
                contentContainerStyle={styles.quickRepliesContent}
              />
              {isTrainerOnboardingComplete ? (
                <View style={styles.activationCard} testID="trainer-activation-card">
                  <Animated.View style={[styles.activationGlow, { opacity: glowOpacity }]} />
                  <ModeText variant="label" style={styles.activationHeading}>
                    Your AI coach is ready.
                  </ModeText>
                  <ModeText variant="body3" style={styles.activationSub}>
                    Everything you shared has been saved. Let&apos;s go.
                  </ModeText>
                  <Pressable
                    testID="trainer-activation-cta"
                    style={({ pressed }) => [
                      styles.activationCTA,
                      (shouldDisableComposer || isActivating) && styles.activationCTADisabled,
                      pressed && styles.activationCTAPressed,
                    ]}
                    onPress={handleActivationPress}
                    disabled={shouldDisableComposer || isActivating}
                    accessibilityLabel="Launch Coach"
                  >
                    <ModeText variant="label" style={styles.activationCTALabel}>
                      {isActivating ? 'Activating...' : 'Launch Coach'}
                    </ModeText>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.composerWrap}>
                  <CoachComposer
                    value={draft}
                    onChangeText={setDraft}
                    onSend={handleSend}
                    onCancel={cancelActiveResponse}
                    isSending={isSending}
                    onFocus={handleComposerFocus}
                    disabled={shouldDisableComposer}
                    placeholder={isAwaitingTrainerEdit ? "Type how you'd say it…" : `Ask ${resolvedTrainerName} anything...`}
                  />
                  <ModeText
                    testID="coach-chat-ai-fitness-disclaimer"
                    variant="body3"
                    style={styles.composerDisclaimer}
                  >
                    AI coaching · not medical advice
                  </ModeText>
                </View>
              )}
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

const headerStyles = StyleSheet.create({
  header: {
    backgroundColor: theme.colors.background.primary,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    gap: 10,
  },
  backButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButtonPressed: {
    opacity: theme.interaction.pressedOpacity,
  },
  backChevron: {
    fontSize: 28,
    color: theme.colors.text.primary,
    lineHeight: 32,
    marginTop: -2,
  },
  backPlaceholder: {
    width: 36,
  },
  avatarWrap: {},
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    fontFamily: theme.typography.fontFamily,
  },
  titleBlock: {
    flex: 1,
    gap: 2,
  },
  titleText: {
    ...theme.typography.headerName,
    fontFamily: theme.typography.fontFamily,
    color: theme.colors.text.primary,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusDotOnline: {
    backgroundColor: '#3CB97A',
  },
  statusDotError: {
    backgroundColor: theme.colors.status.error,
  },
  statusText: {
    ...theme.typography.headerSub,
    fontFamily: theme.typography.fontFamily,
  },
  statusTextOnline: {
    color: '#3CB97A',
  },
  statusTextError: {
    color: theme.colors.status.error,
  },
  rightSlot: {
    width: 36,
  },
});

const openingStyles = StyleSheet.create({
  container: {
    gap: 8,
    paddingTop: 4,
    paddingBottom: 4,
  },
  modeBadgeWrap: {
    alignSelf: 'flex-start',
    marginBottom: 2,
  },
  modeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: theme.radii.chip,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  modeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  modeBadgeText: {
    ...theme.typography.modeLabel,
    fontFamily: theme.typography.fontFamily,
  },
  bubbleWrap: {
    alignSelf: 'flex-start',
    maxWidth: '88%',
    gap: 3,
  },
  aiBubble: {
    backgroundColor: theme.colors.bubble.ai.bg,
    borderWidth: 1,
    borderColor: theme.colors.bubble.ai.border,
    borderRadius: theme.radii.bubble,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 6,
  },
  aiBubbleText: {
    ...theme.typography.body2,
    fontFamily: theme.typography.fontFamily,
    color: theme.colors.bubble.ai.text,
  },
  aiBubbleSubText: {
    ...theme.typography.body3,
    fontFamily: theme.typography.fontFamily,
    color: 'rgba(196,207,238,0.72)',
    marginTop: 2,
  },
  coachLabel: {
    ...theme.typography.bubbleLabel,
    fontFamily: theme.typography.fontFamily,
    color: theme.colors.bubble.ai.label,
    marginBottom: 1,
  },
  sectionLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    alignItems: 'flex-start',
  },
  sectionLabel: {
    ...theme.typography.bubbleLabel,
    fontFamily: theme.typography.fontFamily,
    color: theme.colors.accent.primary,
    letterSpacing: 0.8,
    paddingTop: 2,
    minWidth: 60,
  },
  sectionBody: {
    ...theme.typography.body2,
    fontFamily: theme.typography.fontFamily,
    color: theme.colors.bubble.ai.text,
    flex: 1,
  },
  ctaBubbleWrap: {
    marginTop: 4,
  },
  ctaBubble: {
    backgroundColor: 'rgba(255,255,255,0.065)',
    borderWidth: 1,
    borderColor: theme.colors.bubble.ai.border,
    borderRadius: theme.radii.bubble,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  ctaBubbleText: {
    ...theme.typography.body2,
    fontFamily: theme.typography.fontFamily,
    color: '#D6E4FF',
    fontWeight: '500',
  },
});

const bubbleStyles = StyleSheet.create({
  userRow: {
    alignItems: 'flex-end',
    paddingLeft: '15%',
  },
  userSpeakerLabel: {
    ...theme.typography.bubbleLabel,
    fontFamily: theme.typography.fontFamily,
    color: theme.colors.text.muted,
    marginBottom: 3,
    marginRight: 2,
    alignSelf: 'flex-end',
  },
  userBubble: {
    overflow: 'hidden',
    paddingHorizontal: 14,
    paddingVertical: 9,
    shadowColor: theme.colors.bubble.user.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 12,
    elevation: 4,
  },
  userCornerSingle: {
    borderTopLeftRadius: theme.radii.bubble,
    borderTopRightRadius: theme.radii.bubble,
    borderBottomLeftRadius: theme.radii.bubble,
    borderBottomRightRadius: theme.radii.bubble,
  },
  userCornerStart: {
    borderTopLeftRadius: theme.radii.bubble,
    borderTopRightRadius: theme.radii.bubble,
    borderBottomLeftRadius: theme.radii.bubble,
    borderBottomRightRadius: theme.radii.bubbleSm,
  },
  userCornerMiddle: {
    borderTopLeftRadius: theme.radii.bubble,
    borderTopRightRadius: theme.radii.bubbleSm,
    borderBottomLeftRadius: theme.radii.bubble,
    borderBottomRightRadius: theme.radii.bubbleSm,
  },
  userCornerEnd: {
    borderTopLeftRadius: theme.radii.bubble,
    borderTopRightRadius: theme.radii.bubbleSm,
    borderBottomLeftRadius: theme.radii.bubble,
    borderBottomRightRadius: theme.radii.bubble,
  },
  userBubbleText: {
    ...theme.typography.body2,
    fontFamily: theme.typography.fontFamily,
    color: theme.colors.bubble.user.text,
  },
  aiRow: {
    alignItems: 'flex-start',
    paddingRight: '15%',
  },
  coachLabel: {
    ...theme.typography.bubbleLabel,
    fontFamily: theme.typography.fontFamily,
    color: theme.colors.bubble.ai.label,
    marginBottom: 3,
    marginLeft: 2,
  },
  coachLabelError: {
    color: theme.colors.status.error,
  },
  aiBubble: {
    backgroundColor: theme.colors.bubble.ai.bg,
    borderWidth: 1,
    borderColor: theme.colors.bubble.ai.border,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  aiCornerSingle: {
    borderTopLeftRadius: theme.radii.bubble,
    borderTopRightRadius: theme.radii.bubble,
    borderBottomLeftRadius: theme.radii.bubble,
    borderBottomRightRadius: theme.radii.bubble,
  },
  aiCornerStart: {
    borderTopLeftRadius: theme.radii.bubble,
    borderTopRightRadius: theme.radii.bubble,
    borderBottomLeftRadius: theme.radii.bubbleSm,
    borderBottomRightRadius: theme.radii.bubble,
  },
  aiCornerMiddle: {
    borderTopLeftRadius: theme.radii.bubbleSm,
    borderTopRightRadius: theme.radii.bubble,
    borderBottomLeftRadius: theme.radii.bubbleSm,
    borderBottomRightRadius: theme.radii.bubble,
  },
  aiCornerEnd: {
    borderTopLeftRadius: theme.radii.bubbleSm,
    borderTopRightRadius: theme.radii.bubble,
    borderBottomLeftRadius: theme.radii.bubble,
    borderBottomRightRadius: theme.radii.bubble,
  },
  aiBubbleText: {
    ...theme.typography.body2,
    fontFamily: theme.typography.fontFamily,
    color: theme.colors.bubble.ai.text,
  },
  aiBubbleError: {
    borderColor: 'rgba(197,122,108,0.4)',
  },
  aiBubbleTextError: {
    color: theme.colors.status.error,
  },
});

const styles = StyleSheet.create({
  screen: {
    backgroundColor: theme.colors.background.primary,
  },
  content: {
    flex: 1,
  },
  toolbarContainer: {
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[1],
  },
  ambientGlowContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 300,
    zIndex: 0,
    pointerEvents: 'none',
  },
  ambientGlow: {
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
  fallbackTag: {
    alignSelf: 'flex-start',
    marginTop: 4,
    marginLeft: 2,
    borderRadius: theme.radii.pill,
    backgroundColor: 'rgba(197,122,108,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(197,122,108,0.3)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  userFallbackTag: {
    alignSelf: 'flex-end',
    marginLeft: 0,
    marginRight: 2,
  },
  fallbackTagText: {
    fontSize: 10,
    fontWeight: '500',
    color: theme.colors.status.error,
    letterSpacing: 0.2,
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
    backgroundColor: 'rgba(223, 236, 255, 0.07)',
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    gap: 8,
    overflow: 'hidden',
  },
  checklistItemActive: {
    backgroundColor: 'rgba(223, 236, 255, 0.11)',
    borderWidth: 1,
    borderColor: 'rgba(120, 170, 255, 0.2)',
  },
  checklistSectionLabel: {
    letterSpacing: 0.5,
    fontSize: 10,
  },
  checklistDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.07)',
    marginVertical: 2,
  },
  checklistScenario: {
    lineHeight: 18,
  },
  checklistResponse: {
    lineHeight: 20,
  },
  checklistApprovedBadge: {
    alignSelf: 'flex-start',
    borderRadius: theme.radii.pill,
    backgroundColor: theme.colors.accent.soft,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 3,
    overflow: 'hidden',
  },
  checklistActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
    flexWrap: 'wrap',
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
  checklistEditContainer: {
    gap: 6,
  },
  checklistEditInput: {
    ...theme.typography.body2,
    fontFamily: theme.typography.fontFamily,
    color: theme.colors.text.primary,
    borderRadius: theme.radii.s,
    borderWidth: 1,
    borderColor: 'rgba(120, 170, 255, 0.3)',
    backgroundColor: 'rgba(10, 20, 38, 0.6)',
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    minHeight: 60,
    textAlignVertical: 'top',
  },
  quickReplies: {
    marginBottom: theme.spacing[1],
  },
  quickRepliesContent: {
    paddingHorizontal: 0,
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
  notConnectedBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    backgroundColor: theme.colors.feedback.errorBg,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.feedback.errorBorder,
  },
  notConnectedText: {
    color: theme.colors.status.error,
    flex: 1,
  },
  notConnectedCopyFeedback: {
    color: theme.colors.text.secondary,
    marginRight: theme.spacing[1],
  },
  notConnectedRetry: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 4,
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    borderColor: theme.colors.status.error,
    marginLeft: theme.spacing[2],
  },
  notConnectedRetryPressed: {
    opacity: theme.interaction.pressedOpacity,
  },
  notConnectedRetryText: {
    color: theme.colors.status.error,
  },
  composerWrap: {
    gap: 4,
  },
  composerDisclaimer: {
    textAlign: 'center',
    fontSize: 9,
    color: theme.colors.text.disabled,
    paddingBottom: 2,
    letterSpacing: 0.1,
  },
  activationCard: {
    marginHorizontal: theme.spacing[2],
    marginBottom: theme.spacing[2],
    borderRadius: theme.radii.l,
    backgroundColor: theme.colors.surface.overlay,
    borderWidth: 1,
    borderColor: theme.colors.border.subtle,
    padding: theme.spacing[4],
    alignItems: 'center',
    gap: theme.spacing[2],
    overflow: 'hidden',
  },
  activationGlow: {
    position: 'absolute',
    top: -36,
    left: 0,
    right: 0,
    height: 72,
    borderRadius: 36,
    backgroundColor: theme.colors.accent.glow,
  },
  activationHeading: {
    color: theme.colors.text.primary,
    textAlign: 'center',
  },
  activationSub: {
    color: theme.colors.text.secondary,
    textAlign: 'center',
  },
  activationCTA: {
    marginTop: theme.spacing[1],
    paddingHorizontal: theme.spacing[5],
    paddingVertical: theme.spacing[3],
    borderRadius: theme.radii.pill,
    backgroundColor: theme.colors.accent.primary,
    alignItems: 'center',
  },
  activationCTADisabled: {
    opacity: 0.45,
  },
  activationCTAPressed: {
    opacity: theme.interaction.pressedOpacity,
  },
  activationCTALabel: {
    color: theme.colors.text.inverse,
  },
});

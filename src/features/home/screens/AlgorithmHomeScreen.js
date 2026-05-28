import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  GlassSurface,
  ModeButton,
  ModeInput,
  ModeText,
  SafeScreen,
} from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import AlgorithmSummaryCard from '../components/AlgorithmSummaryCard';
import {
  createMyMemory,
  deleteMyMemory,
  getMyAlgorithm,
  patchMyWhy,
  updateMyMemory,
} from '../services/algorithmApi';

const EMPTY_SUMMARY = 'MODE is still learning what drives you. Add your Why to personalize your coaching.';
const SUMMARY_WORD_LIMIT = 30;
const WHY_SUMMARY_PREFIX = "You're building strength, energy, and consistency around what matters most:";
const MODE_ALIASES = {
  base: 'build',
  build: 'build',
  green: 'build',
  beast: 'beast',
  overdrive: 'beast',
  red: 'beast',
  recover: 'recover',
  recovery: 'recover',
  yellow: 'recover',
  rest: 'rest',
  reset: 'rest',
  blue: 'rest',
};
const MEMORY_INPUT_MIN_HEIGHT = 30;
const MEMORY_INPUT_MAX_HEIGHT = 92;

function normalizePayload(payload) {
  return {
    client_id: payload?.client_id || null,
    summary_text: payload?.summary_text || EMPTY_SUMMARY,
    user_why: payload?.user_why || '',
    algorithm_summary_updated_at: payload?.algorithm_summary_updated_at || null,
    memories: Array.isArray(payload?.memories) ? payload.memories : [],
  };
}

function limitSummaryWords(value) {
  const words = String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  if (words.length <= SUMMARY_WORD_LIMIT) {
    return words.join(' ');
  }
  return `${words.slice(0, SUMMARY_WORD_LIMIT).join(' ').replace(/[.,;:]+$/, '')}...`;
}

function buildSummaryText(payload) {
  const why = String(payload?.user_why || '').replace(/\s+/g, ' ').trim();
  if (why) {
    return limitSummaryWords(`${WHY_SUMMARY_PREFIX} ${why}`);
  }
  return payload?.summary_text || EMPTY_SUMMARY;
}

function getModeTheme(currentMode) {
  const normalized = typeof currentMode === 'string' ? currentMode.trim().toLowerCase() : '';
  return theme.modes[MODE_ALIASES[normalized]] || theme.modes.fallback;
}

function colorWithOpacity(hexColor, opacity) {
  const normalized = String(hexColor || '').replace('#', '');
  if (![3, 6].includes(normalized.length)) {
    return hexColor;
  }
  const full = normalized.length === 3
    ? normalized.split('').map((char) => `${char}${char}`).join('')
    : normalized;
  const red = parseInt(full.slice(0, 2), 16);
  const green = parseInt(full.slice(2, 4), 16);
  const blue = parseInt(full.slice(4, 6), 16);
  if ([red, green, blue].some((value) => Number.isNaN(value))) {
    return hexColor;
  }
  return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
}

function capitalizeFirst(value) {
  if (!value) {
    return '';
  }
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function getGreetingName(viewerDisplayName) {
  const trimmed = String(viewerDisplayName || '').trim();
  if (!trimmed) {
    return 'there';
  }
  const withoutDomain = trimmed.includes('@') ? trimmed.split('@')[0] : trimmed;
  const firstToken = withoutDomain.split(/\s+/)[0].split(/[._-]/)[0];
  return capitalizeFirst(firstToken || 'there');
}

function formatHeaderDate(date = new Date()) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    }).format(date);
  } catch (_error) {
    return 'Today';
  }
}

function normalizeReadinessScore(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatReadinessScore(value) {
  const score = normalizeReadinessScore(value);
  if (score === null) {
    return '--';
  }
  const rounded = Math.round(score);
  return `${rounded} / ${rounded > 25 ? 100 : 25}`;
}

function getInputHeightFromEvent(event) {
  const nextHeight = Number(event?.nativeEvent?.contentSize?.height);
  if (!Number.isFinite(nextHeight)) {
    return MEMORY_INPUT_MIN_HEIGHT;
  }
  return Math.min(MEMORY_INPUT_MAX_HEIGHT, Math.max(MEMORY_INPUT_MIN_HEIGHT, Math.ceil(nextHeight)));
}

function InlineMemoryEditor({
  value,
  onChangeText,
  onSave,
  onCancel,
  onContentSizeChange,
  inputHeight,
  saving,
  placeholder,
  error,
  modeTheme,
  testID,
}) {
  return (
    <GlassSurface
      testID={testID}
      state="active"
      radius="l"
      padding={0}
      style={styles.memoryEditorChip}
      contentStyle={styles.memoryEditorContent}
      fillColor={theme.memoryChip.fillEditing}
      borderColor={modeTheme.cardBorder}
      highlight
    >
      <TextInput
        testID="algorithm-memory-input"
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.text.muted}
        selectionColor={modeTheme.accent}
        multiline
        autoFocus
        autoCapitalize="sentences"
        autoCorrect
        maxLength={240}
        editable={!saving}
        onContentSizeChange={onContentSizeChange}
        style={[
          styles.memoryInlineInput,
          {
            color: theme.colors.text.primary,
            height: inputHeight,
          },
        ]}
      />
      <View style={styles.memoryEditorActions}>
        <Pressable
          testID="algorithm-memory-save"
          accessibilityRole="button"
          accessibilityLabel="Save fact"
          hitSlop={8}
          disabled={saving}
          onPress={onSave}
          style={({ pressed }) => [
            styles.memoryIconButton,
            { borderColor: modeTheme.cardBorder, backgroundColor: modeTheme.accentSoft },
            pressed && styles.pressedControl,
            saving && styles.disabledControl,
          ]}
        >
          {saving ? (
            <ActivityIndicator size="small" color={modeTheme.accentStrong} />
          ) : (
            <Feather name="check" size={17} color={modeTheme.accentStrong} />
          )}
        </Pressable>
        <Pressable
          testID="algorithm-memory-cancel"
          accessibilityRole="button"
          accessibilityLabel="Cancel fact edit"
          hitSlop={8}
          disabled={saving}
          onPress={onCancel}
          style={({ pressed }) => [
            styles.memoryIconButton,
            pressed && styles.pressedControl,
            saving && styles.disabledControl,
          ]}
        >
          <Feather name="x" size={17} color={theme.colors.text.secondary} />
        </Pressable>
      </View>
      {error ? (
        <ModeText variant="caption" tone="error" style={styles.memoryEditorError}>
          {error}
        </ModeText>
      ) : null}
    </GlassSurface>
  );
}

function MemoryFactChip({
  memory,
  modeTheme,
  onPress,
  onLongPress,
  onDelete,
  isDeleteCandidate,
  isMutating,
}) {
  const wobble = useRef(new Animated.Value(0)).current;
  const canEdit = Boolean(memory?.can_edit);

  useEffect(() => {
    if (!isDeleteCandidate) {
      wobble.stopAnimation();
      wobble.setValue(0);
      return undefined;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(wobble, {
          toValue: -1,
          duration: theme.animation.duration.short,
          useNativeDriver: false,
        }),
        Animated.timing(wobble, {
          toValue: 1,
          duration: theme.animation.duration.short,
          useNativeDriver: false,
        }),
        Animated.timing(wobble, {
          toValue: 0,
          duration: theme.animation.duration.short,
          useNativeDriver: false,
        }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
    };
  }, [isDeleteCandidate, wobble]);

  const wobbleStyle = {
    transform: [
      {
        rotate: wobble.interpolate({
          inputRange: [-1, 1],
          outputRange: ['-1.2deg', '1.2deg'],
        }),
      },
    ],
  };

  return (
    <Animated.View style={[styles.memoryChipWrap, isDeleteCandidate && wobbleStyle]}>
      <TouchableOpacity
        testID={`algorithm-memory-pill-${memory.id}`}
        activeOpacity={theme.interaction.pressedOpacity}
        delayLongPress={400}
        disabled={isMutating || !canEdit}
        onPress={canEdit ? onPress : undefined}
        onLongPress={canEdit ? onLongPress : undefined}
        accessibilityRole={canEdit ? 'button' : undefined}
        accessibilityLabel={canEdit ? `Edit fact: ${memory.text}` : `Fact: ${memory.text}`}
        style={[styles.memoryPillTouch, isMutating && styles.disabledControl]}
      >
        <GlassSurface
          state={memory?.ai_usable ? 'active' : 'default'}
          radius={12}
          padding={0}
          style={styles.memoryPill}
          contentStyle={styles.memoryPillContent}
          borderColor={isDeleteCandidate ? theme.memoryChip.borderDelete : modeTheme.cardBorder}
          fillColor={isDeleteCandidate ? theme.memoryChip.fillDelete : theme.memoryChip.fill}
          highlight={memory?.ai_usable}
        >
          <ModeText variant="bodySm" style={styles.memoryPillText}>
            {memory.text}
          </ModeText>
        </GlassSurface>
      </TouchableOpacity>
      {isDeleteCandidate ? (
        <Pressable
          testID="algorithm-memory-delete"
          accessibilityRole="button"
          accessibilityLabel="Delete fact"
          hitSlop={10}
          disabled={isMutating}
          onPress={onDelete}
          style={({ pressed }) => [
            styles.deleteBadge,
            pressed && styles.pressedControl,
            isMutating && styles.disabledControl,
          ]}
        >
          {isMutating ? (
            <ActivityIndicator size="small" color={theme.memoryChip.badgeText} />
          ) : (
            <Feather name="x" size={14} color={theme.memoryChip.badgeText} />
          )}
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

function ModeAtmosphere({ modeTheme }) {
  const secondaryGlow = colorWithOpacity(modeTheme.accent, 0.07);

  return (
    <View pointerEvents="none" style={styles.modeAtmosphere}>
      <LinearGradient
        colors={[modeTheme.backgroundAlt, modeTheme.background]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={['rgba(40,80,255,0.22)', 'rgba(20,40,160,0.06)', 'transparent']}
        start={{ x: 0.65, y: 0 }}
        end={{ x: 0.35, y: 1 }}
        style={styles.primaryGlow}
      />
      <LinearGradient
        colors={[secondaryGlow, theme.colors.utility.transparent]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={styles.secondaryGlow}
      />
    </View>
  );
}

function LoadingSkeleton({ bottomInset, modeTheme }) {
  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        { paddingTop: theme.spacing[3], paddingBottom: bottomInset + theme.spacing[5] },
      ]}
    >
      <View style={styles.phoneFrame}>
        <View style={styles.headerBlock}>
          <View style={[styles.skeletonTitle, { backgroundColor: modeTheme.cardFill }]} />
        </View>
        <View style={[styles.skeletonCard, styles.skeletonHero, { borderColor: modeTheme.cardBorder }]} />
        <View style={[styles.skeletonCard, { borderColor: modeTheme.cardBorder }]} />
        <View style={styles.skeletonPillRow}>
          <View style={styles.skeletonPill} />
          <View style={styles.skeletonPillWide} />
          <View style={styles.skeletonPill} />
        </View>
      </View>
    </ScrollView>
  );
}

export default function AlgorithmHomeScreen({
  accessToken,
  bottomInset = 0,
  memoryRefreshToken = 0,
  currentMode = null,
  readinessScore = null,
  viewerDisplayName = null,
}) {
  const insets = useSafeAreaInsets();
  const feedbackTimerRef = useRef(null);
  const [payload, setPayload] = useState(() => normalizePayload(null));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [whyEditing, setWhyEditing] = useState(false);
  const [whyDraft, setWhyDraft] = useState('');
  const [whySaving, setWhySaving] = useState(false);
  const [whyError, setWhyError] = useState(null);
  const [editingMemoryId, setEditingMemoryId] = useState(null);
  const [memoryDraft, setMemoryDraft] = useState('');
  const [memoryDraftHeight, setMemoryDraftHeight] = useState(MEMORY_INPUT_MIN_HEIGHT);
  const [addingMemory, setAddingMemory] = useState(false);
  const [newMemoryDraft, setNewMemoryDraft] = useState('');
  const [newMemoryDraftHeight, setNewMemoryDraftHeight] = useState(MEMORY_INPUT_MIN_HEIGHT);
  const [deleteCandidateId, setDeleteCandidateId] = useState(null);
  const [memorySavingId, setMemorySavingId] = useState(null);
  const [memoryDeletingId, setMemoryDeletingId] = useState(null);
  const [memoryError, setMemoryError] = useState(null);

  const isMemoryMutating = Boolean(memorySavingId || memoryDeletingId);
  const modeTheme = useMemo(() => getModeTheme(currentMode), [currentMode]);
  const greetingName = useMemo(() => getGreetingName(viewerDisplayName), [viewerDisplayName]);
  const headerDate = useMemo(() => formatHeaderDate(), []);
  const readinessLabel = useMemo(() => formatReadinessScore(readinessScore), [readinessScore]);
  const readinessTextColor = colorWithOpacity(modeTheme.accent, 0.55);

  const showFeedback = useCallback((message) => {
    setFeedback(message);
    if (feedbackTimerRef.current) {
      clearTimeout(feedbackTimerRef.current);
    }
    feedbackTimerRef.current = setTimeout(() => {
      setFeedback(null);
    }, 2200);
  }, []);

  const loadAlgorithm = useCallback(async () => {
    if (!accessToken) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const nextPayload = await getMyAlgorithm({ accessToken });
      setPayload(normalizePayload(nextPayload));
    } catch (loadError) {
      setError(loadError);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    loadAlgorithm();
    return () => {
      if (feedbackTimerRef.current) {
        clearTimeout(feedbackTimerRef.current);
      }
    };
  }, [loadAlgorithm, memoryRefreshToken]);

  const openWhyEditor = useCallback(() => {
    if (whySaving) {
      return;
    }
    setWhyDraft(payload.user_why || '');
    setWhyError(null);
    setWhyEditing(true);
  }, [payload.user_why, whySaving]);

  const closeWhyEditor = useCallback(() => {
    if (whySaving) {
      return;
    }
    setWhyDraft(payload.user_why || '');
    setWhyError(null);
    setWhyEditing(false);
  }, [payload.user_why, whySaving]);

  const handleSaveWhy = useCallback(async () => {
    const previous = payload;
    const optimistic = {
      ...payload,
      user_why: whyDraft.trim(),
    };
    setWhySaving(true);
    setWhyError(null);
    setPayload(optimistic);
    try {
      const nextPayload = await patchMyWhy({
        accessToken,
        userWhy: whyDraft.trim(),
      });
      setPayload(normalizePayload(nextPayload));
      setWhyEditing(false);
      showFeedback('Saved to your coaching context.');
    } catch (saveError) {
      setPayload(previous);
      setWhyError(saveError?.message || 'Unable to save your Why.');
    } finally {
      setWhySaving(false);
    }
  }, [accessToken, payload, showFeedback, whyDraft]);

  const visibleMemories = useMemo(() => payload.memories || [], [payload.memories]);
  const summaryText = useMemo(() => buildSummaryText(payload), [payload]);

  const openAddMemory = useCallback(() => {
    if (isMemoryMutating) {
      return;
    }
    setAddingMemory(true);
    setEditingMemoryId(null);
    setDeleteCandidateId(null);
    setNewMemoryDraft('');
    setNewMemoryDraftHeight(MEMORY_INPUT_MIN_HEIGHT);
    setMemoryError(null);
  }, [isMemoryMutating]);

  const openEditMemory = useCallback((memory) => {
    if (!memory?.can_edit || isMemoryMutating) {
      return;
    }
    setAddingMemory(false);
    setEditingMemoryId(memory.id);
    setDeleteCandidateId(null);
    setMemoryDraft(memory?.text || '');
    setMemoryDraftHeight(MEMORY_INPUT_MIN_HEIGHT);
    setMemoryError(null);
  }, [isMemoryMutating]);

  const closeMemoryDraft = useCallback(() => {
    if (isMemoryMutating) {
      return;
    }
    setAddingMemory(false);
    setEditingMemoryId(null);
    setDeleteCandidateId(null);
    setMemoryDraft('');
    setNewMemoryDraft('');
    setMemoryError(null);
  }, [isMemoryMutating]);

  const armDeleteMemory = useCallback((memory) => {
    if (!memory?.can_edit || isMemoryMutating) {
      return;
    }
    setAddingMemory(false);
    setEditingMemoryId(null);
    setDeleteCandidateId(memory.id);
    setMemoryError(null);
  }, [isMemoryMutating]);

  const handleSaveEditedMemory = useCallback(async () => {
    const memory = visibleMemories.find((item) => item.id === editingMemoryId);
    const text = memoryDraft.trim();
    if (!memory?.id || !memory?.can_edit) {
      return;
    }
    if (!text) {
      setMemoryError('Add a fact first.');
      return;
    }

    const previous = payload;
    const draftRecord = {
      ...memory,
      text,
      category: memory?.category || null,
      source: memory?.source || 'user',
      ai_usable: Boolean(memory?.ai_usable),
      client_visible: memory?.client_visible !== false,
      can_edit: true,
      tags: Array.isArray(memory?.tags) ? memory.tags : [],
    };
    setMemorySavingId(memory.id);
    setMemoryError(null);
    setPayload((current) => ({
      ...current,
      memories: current.memories.map((item) => (
        item.id === memory.id ? draftRecord : item
      )),
    }));

    try {
      const nextPayload = await updateMyMemory({
        accessToken,
        memoryId: memory.id,
        text,
        category: memory?.category || null,
        aiUsable: Boolean(memory?.ai_usable),
        tags: Array.isArray(memory?.tags) ? memory.tags : [],
      });
      setPayload(normalizePayload(nextPayload));
      setEditingMemoryId(null);
      setMemoryDraft('');
      showFeedback('Fact updated.');
    } catch (saveError) {
      setPayload(previous);
      setMemoryError(saveError?.message || 'Unable to save fact.');
    } finally {
      setMemorySavingId(null);
    }
  }, [accessToken, editingMemoryId, memoryDraft, payload, showFeedback, visibleMemories]);

  const handleCreateMemory = useCallback(async () => {
    const text = newMemoryDraft.trim();
    if (!text) {
      setMemoryError('Add a fact first.');
      return;
    }

    const previous = payload;
    const draftRecord = {
      id: `optimistic-${Date.now()}`,
      text,
      category: null,
      source: 'user',
      ai_usable: true,
      client_visible: true,
      can_edit: true,
      tags: [],
    };
    setMemorySavingId('new');
    setMemoryError(null);
    setPayload((current) => ({
      ...current,
      memories: [draftRecord, ...current.memories],
    }));

    try {
      const nextPayload = await createMyMemory({
        accessToken,
        text,
        category: null,
        aiUsable: true,
        tags: [],
      });
      setPayload(normalizePayload(nextPayload));
      setAddingMemory(false);
      setNewMemoryDraft('');
      showFeedback('Fact added.');
    } catch (saveError) {
      setPayload(previous);
      setMemoryError(saveError?.message || 'Unable to save fact.');
    } finally {
      setMemorySavingId(null);
    }
  }, [accessToken, newMemoryDraft, payload, showFeedback]);

  const handleDeleteMemory = useCallback(async (memory) => {
    if (!memory?.id || !memory?.can_edit || isMemoryMutating) {
      return;
    }

    const previous = payload;
    setMemoryDeletingId(memory.id);
    setMemoryError(null);
    setPayload((current) => ({
      ...current,
      memories: current.memories.filter((item) => item.id !== memory.id),
    }));

    try {
      const nextPayload = await deleteMyMemory({ accessToken, memoryId: memory.id });
      setPayload(normalizePayload(nextPayload));
      setDeleteCandidateId(null);
      showFeedback('Fact deleted.');
    } catch (deleteError) {
      setPayload(previous);
      setMemoryError(deleteError?.message || 'Unable to delete fact.');
    } finally {
      setMemoryDeletingId(null);
    }
  }, [accessToken, isMemoryMutating, payload, showFeedback]);

  const whyHeaderAction = whySaving ? (
    <ActivityIndicator size="small" color={modeTheme.accentStrong} />
  ) : whyEditing ? (
    <Pressable
      testID="algorithm-why-save"
      accessibilityRole="button"
      accessibilityLabel="Save Why"
      hitSlop={8}
      onPress={handleSaveWhy}
      style={({ pressed }) => [
        styles.whyHeaderAction,
        { borderColor: modeTheme.cardBorder, backgroundColor: modeTheme.accentSoft },
        pressed && styles.pressedControl,
      ]}
    >
      <Feather name="save" size={18} color={modeTheme.accentStrong} />
    </Pressable>
  ) : (
    <Feather name="edit-2" size={18} color={modeTheme.accentStrong} />
  );

  if (loading) {
    return (
      <SafeScreen includeTopInset={false} style={[styles.screen, { backgroundColor: modeTheme.background }]}>
        <ModeAtmosphere modeTheme={modeTheme} />
        <LoadingSkeleton bottomInset={bottomInset} modeTheme={modeTheme} />
      </SafeScreen>
    );
  }

  if (error) {
    return (
      <SafeScreen includeTopInset={false} style={[styles.screen, { backgroundColor: modeTheme.background }]}>
        <ModeAtmosphere modeTheme={modeTheme} />
        <View style={[styles.errorWrap, { paddingTop: Math.max(insets.top, theme.spacing[3]) }]}>
          <GlassSurface
            state="elevated"
            radius="xl"
            padding={theme.spacing[4]}
            style={styles.errorCard}
            fillColor={modeTheme.cardFill}
            borderColor={modeTheme.cardBorder}
          >
            <ModeText variant="h3">Your MODE algorithm is offline.</ModeText>
            <ModeText variant="bodySm" tone="secondary" style={styles.errorText}>
              {error?.message || 'Unable to load your coaching context.'}
            </ModeText>
            <ModeButton title="Retry" variant="secondary" onPress={loadAlgorithm} style={styles.retryButton} />
          </GlassSurface>
        </View>
      </SafeScreen>
    );
  }

  return (
    <SafeScreen includeTopInset={false} style={[styles.screen, { backgroundColor: modeTheme.background }]}>
      <ModeAtmosphere modeTheme={modeTheme} />
      <KeyboardAvoidingView behavior="padding" style={styles.keyboardAvoidingView}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.content,
            {
              paddingTop: Math.max(insets.top, theme.spacing[3]),
              paddingBottom: bottomInset + theme.spacing[5],
            },
          ]}
        >
        <View style={styles.phoneFrame}>
          {whyEditing ? (
            <Pressable
              testID="algorithm-why-dismiss-backdrop"
              onPress={closeWhyEditor}
              style={styles.whyDismissBackdrop}
              accessible={false}
            />
          ) : null}
          <View style={styles.headerBlock}>
            <ModeText testID="algorithm-home-greeting" variant="bodySm" tone="secondary" style={styles.greetingText}>
              {`Good morning, ${greetingName}`}
            </ModeText>
            <ModeText variant="caption" tone="tertiary" style={styles.dateText}>
              {headerDate}
            </ModeText>
            <ModeText
              testID="algorithm-home-mode-label"
              variant="display"
              style={[styles.modeTitle, { color: modeTheme.accentStrong }]}
              numberOfLines={2}
            >
              {modeTheme.displayLabel}
            </ModeText>
            <ModeText
              testID="algorithm-home-readiness-score"
              variant="caption"
              style={[styles.readinessText, { color: readinessTextColor }]}
            >
              {`${readinessLabel} readiness`}
            </ModeText>
          </View>

          <AlgorithmSummaryCard
            testID="algorithm-why-card"
            textTestID="algorithm-summary-card-text"
            label="Your Why"
            summaryText={summaryText}
            animate={!whyEditing}
            accentColor={modeTheme.accentStrong}
            fillColor={modeTheme.cardFill}
            borderColor={modeTheme.cardBorder}
            headerTrailing={whyHeaderAction}
            style={[styles.sectionCard, whyEditing && styles.whyCardEditing]}
            onPress={whyEditing ? undefined : openWhyEditor}
            accessibilityLabel="Edit your Why"
          >
            {whyEditing ? (
              <>
                <ModeInput
                  testID="algorithm-why-input"
                  value={whyDraft}
                  onChangeText={setWhyDraft}
                  placeholder="Add the reason this matters."
                  multiline
                  autoFocus
                  autoCapitalize="sentences"
                  autoCorrect
                  maxLength={500}
                  editable={!whySaving}
                  style={styles.whyInlineInput}
                />
                {whyError ? <ModeText variant="caption" tone="error">{whyError}</ModeText> : null}
              </>
            ) : null}
          </AlgorithmSummaryCard>

          <View style={styles.memorySection}>
            <View style={styles.memoryHeaderRow}>
              <View style={styles.sectionHeaderCopy}>
                <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>
                  Memory
                </ModeText>
                <ModeText variant="bodySm" tone="secondary" style={styles.memorySubtitle}>
                  Facts your coach can use today
                </ModeText>
              </View>
            </View>
            <ModeText
              testID="algorithm-memory-management-hint"
              variant="caption"
              style={[styles.memoryHint, { color: theme.memoryChip.hintText }]}
            >
              Tap to edit. Hold to remove.
            </ModeText>
            {memoryError && !addingMemory && !editingMemoryId ? (
              <ModeText variant="caption" tone="error" style={styles.memorySectionError}>
                {memoryError}
              </ModeText>
            ) : null}
            <View style={styles.memoryPillWrap}>
              {visibleMemories.map((memory) => (
                editingMemoryId === memory.id ? (
                  <InlineMemoryEditor
                    key={memory.id}
                    testID={`algorithm-memory-editor-${memory.id}`}
                    value={memoryDraft}
                    onChangeText={setMemoryDraft}
                    onSave={handleSaveEditedMemory}
                    onCancel={closeMemoryDraft}
                    inputHeight={memoryDraftHeight}
                    onContentSizeChange={(event) => setMemoryDraftHeight(getInputHeightFromEvent(event))}
                    saving={memorySavingId === memory.id}
                    placeholder="What should your coach remember?"
                    error={memoryError}
                    modeTheme={modeTheme}
                  />
                ) : (
                  <MemoryFactChip
                    key={memory.id}
                    memory={memory}
                    modeTheme={modeTheme}
                    onPress={() => openEditMemory(memory)}
                    onLongPress={() => armDeleteMemory(memory)}
                    onDelete={() => handleDeleteMemory(memory)}
                    isDeleteCandidate={deleteCandidateId === memory.id}
                    isMutating={memoryDeletingId === memory.id}
                  />
                )
              ))}
              {addingMemory ? (
                <InlineMemoryEditor
                  testID="algorithm-memory-editor-new"
                  value={newMemoryDraft}
                  onChangeText={setNewMemoryDraft}
                  onSave={handleCreateMemory}
                  onCancel={closeMemoryDraft}
                  inputHeight={newMemoryDraftHeight}
                  onContentSizeChange={(event) => setNewMemoryDraftHeight(getInputHeightFromEvent(event))}
                  saving={memorySavingId === 'new'}
                  placeholder="Add a fact for your coach"
                  error={memoryError}
                  modeTheme={modeTheme}
                />
              ) : (
                <GlassSurface
                  testID="algorithm-add-memory"
                  state="default"
                  radius={12}
                  padding={0}
                  disabled={isMemoryMutating}
                  onPress={openAddMemory}
                  accessibilityLabel="Add fact"
                  style={styles.addMemoryPill}
                  contentStyle={styles.addMemoryContent}
                  borderColor={modeTheme.cardBorder}
                  fillColor={theme.memoryChip.fillActive}
                >
                  <Feather name="plus" size={15} color={modeTheme.accentStrong} />
                  <ModeText variant="bodySm" style={[styles.addMemoryText, { color: modeTheme.accentStrong }]}>
                    Add fact
                  </ModeText>
                </GlassSurface>
              )}
            </View>
            {visibleMemories.length === 0 && !addingMemory ? (
              <ModeText variant="bodySm" tone="secondary" style={styles.emptyMemoryText}>
                Add what your coach should remember for better motivation and accountability.
              </ModeText>
            ) : null}
          </View>

          {feedback ? (
            <GlassSurface state="default" radius="l" padding={theme.spacing[2]} style={styles.feedbackCard}>
              <ModeText variant="caption" tone="secondary">{feedback}</ModeText>
            </GlassSurface>
          ) : null}
        </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background.app,
  },
  modeAtmosphere: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  primaryGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 300,
  },
  secondaryGlow: {
    position: 'absolute',
    top: 100,
    left: 0,
    right: 0,
    height: 200,
  },
  content: {
    paddingHorizontal: theme.spacing[3],
    alignItems: 'center',
    position: 'relative',
  },
  phoneFrame: {
    width: '100%',
    maxWidth: 390,
    alignSelf: 'center',
    position: 'relative',
  },
  headerBlock: {
    marginBottom: 0,
  },
  greetingText: {
    marginBottom: 1,
    letterSpacing: 0,
  },
  dateText: {
    marginBottom: 12,
    letterSpacing: 0,
  },
  modeTitle: {
    marginTop: 0,
    marginBottom: 4,
    letterSpacing: 0,
  },
  readinessText: {
    marginTop: 0,
    marginBottom: 20,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '500',
    letterSpacing: 0,
  },
  title: {
    color: theme.colors.text.primary,
    letterSpacing: 0,
  },
  sectionCard: {
    marginTop: 0,
  },
  whyDismissBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
    backgroundColor: theme.colors.utility.transparent,
  },
  whyCardEditing: {
    position: 'relative',
    zIndex: 2,
    elevation: 2,
  },
  whyHeaderAction: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressedControl: {
    opacity: theme.interaction.pressedOpacity,
    transform: [{ scale: theme.interaction.pressedScale }],
  },
  disabledControl: {
    opacity: theme.interaction.disabledOpacity,
  },
  sectionCardContent: {
    gap: theme.spacing[2],
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[2],
  },
  sectionHeaderCopy: {
    flex: 1,
  },
  sectionLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0,
    marginBottom: theme.spacing[1],
  },
  sectionTitle: {
    color: theme.colors.text.primary,
    letterSpacing: 0,
  },
  whyInlineInput: {
    marginTop: 0,
  },
  memorySection: {
    marginTop: theme.spacing[4],
  },
  memoryHeaderRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[2],
  },
  memorySubtitle: {
    letterSpacing: 0,
  },
  memoryHint: {
    marginTop: theme.spacing[1],
    letterSpacing: 0,
  },
  memorySectionError: {
    marginTop: theme.spacing[1],
  },
  memoryPillWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: theme.spacing[2],
  },
  memoryChipWrap: {
    maxWidth: '100%',
    position: 'relative',
    alignSelf: 'flex-start',
  },
  memoryPillTouch: {
    maxWidth: '100%',
    alignSelf: 'flex-start',
  },
  memoryPill: {
    maxWidth: '100%',
    alignSelf: 'flex-start',
    borderRadius: 12,
  },
  memoryPillContent: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 36,
    justifyContent: 'center',
  },
  memoryPillTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[1],
  },
  memoryPillText: {
    flexShrink: 1,
    fontWeight: '500',
    letterSpacing: 0,
  },
  memoryEditorChip: {
    flex: 1,
    minWidth: 220,
    maxWidth: '100%',
    alignSelf: 'flex-start',
  },
  memoryEditorContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  memoryInlineInput: {
    minWidth: 142,
    flexGrow: 1,
    flexShrink: 1,
    paddingHorizontal: 0,
    paddingVertical: 0,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.body2.fontSize,
    lineHeight: theme.typography.body2.lineHeight,
    fontWeight: '400',
    textAlignVertical: 'center',
  },
  memoryEditorActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  memoryIconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: theme.colors.glass.borderDefault,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memoryEditorError: {
    width: '100%',
    letterSpacing: 0,
  },
  deleteBadge: {
    position: 'absolute',
    top: -8,
    right: -8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: theme.memoryChip.badgeFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memoryPillMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  memoryMetaText: {
    letterSpacing: 0,
  },
  memoryMetaDot: {
    width: 3,
    height: 3,
    borderRadius: 999,
    backgroundColor: theme.colors.text.tertiary,
  },
  addMemoryPill: {
    minHeight: 36,
    borderRadius: 12,
  },
  addMemoryContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  addMemoryText: {
    fontWeight: '700',
    letterSpacing: 0,
  },
  emptyMemoryText: {
    marginTop: theme.spacing[2],
    letterSpacing: 0,
  },
  feedbackCard: {
    marginTop: theme.spacing[3],
    alignSelf: 'flex-start',
  },
  errorWrap: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing[3],
  },
  errorCard: {
    width: '100%',
    maxWidth: 390,
    alignSelf: 'center',
  },
  errorText: {
    marginTop: theme.spacing[1],
  },
  retryButton: {
    marginTop: theme.spacing[3],
  },
  sheetLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  sheetInput: {
    marginTop: theme.spacing[1],
  },
  sheetTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[2],
  },
  sheetTitleCopy: {
    flex: 1,
  },
  sheetHeaderSaveButton: {
    width: 92,
    flexShrink: 0,
  },
  sheetActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: theme.spacing[1],
    marginTop: theme.spacing[1],
  },
  sheetDeleteButton: {
    width: 116,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[2],
    marginVertical: theme.spacing[1],
  },
  toggleCopy: {
    flex: 1,
  },
  skeletonCard: {
    height: 96,
    borderRadius: theme.radii.xl,
    backgroundColor: theme.colors.glass.elevated,
    marginTop: theme.spacing[3],
    borderWidth: 1,
    borderColor: theme.colors.glass.borderSoft,
  },
  skeletonHero: {
    height: 176,
  },
  skeletonTitle: {
    width: 210,
    height: 26,
    borderRadius: 13,
    backgroundColor: theme.colors.glass.elevated,
  },
  skeletonPillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[1],
    marginTop: theme.spacing[4],
  },
  skeletonPill: {
    width: 118,
    height: 42,
    borderRadius: 21,
    backgroundColor: theme.colors.glass.elevated,
  },
  skeletonPillWide: {
    width: 158,
    height: 42,
    borderRadius: 21,
    backgroundColor: theme.colors.glass.elevated,
  },
});

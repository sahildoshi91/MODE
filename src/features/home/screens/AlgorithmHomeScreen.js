import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  GlassSurface,
  GlassToggle,
  ModeButton,
  ModeInput,
  ModeText,
  SafeScreen,
  SystemActionSheet,
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
const SOURCE_LABELS = {
  user: 'User',
  trainer: 'Trainer',
  ai: 'AI inferred',
};

function normalizePayload(payload) {
  return {
    client_id: payload?.client_id || null,
    summary_text: payload?.summary_text || EMPTY_SUMMARY,
    user_why: payload?.user_why || '',
    algorithm_summary_updated_at: payload?.algorithm_summary_updated_at || null,
    memories: Array.isArray(payload?.memories) ? payload.memories : [],
  };
}

function normalizeTagsText(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 8);
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

function MemoryPill({ memory, onPress }) {
  const sourceLabel = SOURCE_LABELS[memory?.source] || 'Coach';
  const canEdit = Boolean(memory?.can_edit);
  const statusLabel = memory?.ai_usable ? 'AI usable' : 'Private';

  return (
    <GlassSurface
      testID={`algorithm-memory-pill-${memory.id}`}
      state={memory?.ai_usable ? 'active' : 'default'}
      radius="l"
      padding={0}
      onPress={canEdit ? onPress : undefined}
      style={styles.memoryPill}
      contentStyle={styles.memoryPillContent}
      borderColor={memory?.ai_usable ? theme.colors.glass.borderActive : theme.colors.glass.borderSoft}
      fillColor={memory?.ai_usable ? theme.colors.glass.active : theme.colors.glass.elevated}
      highlight={memory?.ai_usable}
    >
      <View style={styles.memoryPillTop}>
        <ModeText variant="bodySm" style={styles.memoryPillText}>
          {memory.text}
        </ModeText>
        {canEdit ? (
          <Feather name="edit-2" size={14} color={theme.colors.text.secondary} />
        ) : null}
      </View>
      <View style={styles.memoryPillMeta}>
        <ModeText variant="caption" tone="tertiary" style={styles.memoryMetaText}>{sourceLabel}</ModeText>
        <View style={styles.memoryMetaDot} />
        <ModeText variant="caption" tone={memory?.ai_usable ? 'accent' : 'tertiary'} style={styles.memoryMetaText}>
          {statusLabel}
        </ModeText>
      </View>
    </GlassSurface>
  );
}

function LoadingSkeleton({ bottomInset }) {
  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        { paddingTop: theme.spacing[3], paddingBottom: bottomInset + theme.spacing[5] },
      ]}
    >
      <View style={styles.phoneFrame}>
        <View style={styles.headerBlock}>
          <View style={styles.skeletonTitle} />
        </View>
        <View style={[styles.skeletonCard, styles.skeletonHero]} />
        <View style={styles.skeletonCard} />
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
  const [memoryEditor, setMemoryEditor] = useState({
    visible: false,
    mode: 'add',
    record: null,
    text: '',
    category: '',
    tagsText: '',
    aiUsable: true,
    saving: false,
    deleting: false,
    error: null,
  });

  const isMemoryMutating = memoryEditor.saving || memoryEditor.deleting;

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

  const openAddMemory = useCallback(() => {
    setMemoryEditor({
      visible: true,
      mode: 'add',
      record: null,
      text: '',
      category: '',
      tagsText: '',
      aiUsable: true,
      saving: false,
      deleting: false,
      error: null,
    });
  }, []);

  const openEditMemory = useCallback((memory) => {
    setMemoryEditor({
      visible: true,
      mode: 'edit',
      record: memory,
      text: memory?.text || '',
      category: memory?.category || '',
      tagsText: Array.isArray(memory?.tags) ? memory.tags.join(', ') : '',
      aiUsable: Boolean(memory?.ai_usable),
      saving: false,
      deleting: false,
      error: null,
    });
  }, []);

  const closeMemoryEditor = useCallback(() => {
    if (isMemoryMutating) {
      return;
    }
    setMemoryEditor((current) => ({
      ...current,
      visible: false,
      error: null,
    }));
  }, [isMemoryMutating]);

  const handleSaveMemory = useCallback(async () => {
    const text = memoryEditor.text.trim();
    if (!text) {
      setMemoryEditor((current) => ({ ...current, error: 'Add a memory first.' }));
      return;
    }
    const previous = payload;
    const draftRecord = {
      id: memoryEditor.record?.id || `optimistic-${Date.now()}`,
      text,
      category: memoryEditor.category.trim() || null,
      source: 'user',
      ai_usable: memoryEditor.aiUsable,
      client_visible: true,
      can_edit: true,
      tags: normalizeTagsText(memoryEditor.tagsText),
    };
    setMemoryEditor((current) => ({
      ...current,
      saving: true,
      deleting: false,
      error: null,
    }));
    setPayload((current) => {
      if (memoryEditor.mode === 'edit') {
        return {
          ...current,
          memories: current.memories.map((item) => (
            item.id === draftRecord.id ? { ...item, ...draftRecord } : item
          )),
        };
      }
      return {
        ...current,
        memories: [draftRecord, ...current.memories],
      };
    });
    try {
      const nextPayload = memoryEditor.mode === 'edit'
        ? await updateMyMemory({
          accessToken,
          memoryId: memoryEditor.record.id,
          text,
          category: memoryEditor.category.trim() || null,
          aiUsable: memoryEditor.aiUsable,
          tags: normalizeTagsText(memoryEditor.tagsText),
        })
        : await createMyMemory({
          accessToken,
          text,
          category: memoryEditor.category.trim() || null,
          aiUsable: memoryEditor.aiUsable,
          tags: normalizeTagsText(memoryEditor.tagsText),
        });
      setPayload(normalizePayload(nextPayload));
      setMemoryEditor((current) => ({
        ...current,
        visible: false,
        saving: false,
        deleting: false,
      }));
      showFeedback(memoryEditor.mode === 'edit' ? 'Memory updated.' : 'Memory added.');
    } catch (saveError) {
      setPayload(previous);
      setMemoryEditor((current) => ({
        ...current,
        saving: false,
        deleting: false,
        error: saveError?.message || 'Unable to save memory.',
      }));
    }
  }, [accessToken, memoryEditor, payload, showFeedback]);

  const handleDeleteMemory = useCallback(async (memory) => {
    if (!memory?.id || !memory?.can_edit) {
      return;
    }
    const previous = payload;
    setMemoryEditor((current) => ({
      ...current,
      saving: false,
      deleting: true,
      error: null,
    }));
    setPayload((current) => ({
      ...current,
      memories: current.memories.filter((item) => item.id !== memory.id),
    }));
    try {
      const nextPayload = await deleteMyMemory({ accessToken, memoryId: memory.id });
      setPayload(normalizePayload(nextPayload));
      showFeedback('Memory deleted.');
      setMemoryEditor((current) => ({
        ...current,
        visible: false,
        saving: false,
        deleting: false,
      }));
    } catch (deleteError) {
      setPayload(previous);
      setMemoryEditor((current) => ({
        ...current,
        saving: false,
        deleting: false,
        error: deleteError?.message || 'Unable to delete memory.',
      }));
    }
  }, [accessToken, payload, showFeedback]);

  const visibleMemories = useMemo(() => payload.memories || [], [payload.memories]);
  const summaryText = useMemo(() => buildSummaryText(payload), [payload]);

  if (loading) {
    return (
      <SafeScreen includeTopInset={false} style={styles.screen} atmosphere="home">
        <LoadingSkeleton bottomInset={bottomInset} />
      </SafeScreen>
    );
  }

  if (error) {
    return (
      <SafeScreen includeTopInset={false} style={styles.screen} atmosphere="home">
        <View style={[styles.errorWrap, { paddingTop: Math.max(insets.top, theme.spacing[3]) }]}>
          <GlassSurface state="elevated" radius="xl" padding={theme.spacing[4]} style={styles.errorCard}>
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
    <SafeScreen includeTopInset={false} style={styles.screen} atmosphere="home">
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
            <ModeText variant="h2" style={styles.title}>Your MODE algorithm</ModeText>
          </View>

          <AlgorithmSummaryCard summaryText={summaryText} />

          <GlassSurface
            testID="algorithm-why-card"
            state="elevated"
            radius="xl"
            padding={theme.spacing[3]}
            style={[styles.sectionCard, whyEditing && styles.whyCardEditing]}
            contentStyle={styles.sectionCardContent}
            onPress={whyEditing ? undefined : openWhyEditor}
          >
            <View style={styles.sectionHeaderRow}>
              <View style={styles.sectionHeaderCopy}>
                <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>Your Why</ModeText>
              </View>
              {whySaving ? (
                <ActivityIndicator size="small" color={theme.colors.accent.primary} />
              ) : whyEditing ? (
                <Pressable
                  testID="algorithm-why-save"
                  accessibilityRole="button"
                  accessibilityLabel="Save Why"
                  hitSlop={8}
                  onPress={handleSaveWhy}
                  style={({ pressed }) => [
                    styles.whyHeaderAction,
                    pressed && styles.whyHeaderActionPressed,
                  ]}
                >
                  <Feather name="save" size={18} color={theme.colors.text.secondary} />
                </Pressable>
              ) : (
                <Feather name="edit-2" size={18} color={theme.colors.text.secondary} />
              )}
            </View>
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
            ) : (
              <ModeText variant="h3" style={styles.sectionTitle}>
                {payload.user_why ? payload.user_why : 'Add the reason this matters.'}
              </ModeText>
            )}
          </GlassSurface>

          <View style={styles.memorySection}>
            <View style={styles.sectionHeaderRow}>
              <View style={styles.sectionHeaderCopy}>
                <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>
                  What your coach knows about you
                </ModeText>
              </View>
            </View>
            <View style={styles.memoryPillWrap}>
              {visibleMemories.map((memory) => (
                <MemoryPill
                  key={memory.id}
                  memory={memory}
                  onPress={() => openEditMemory(memory)}
                />
              ))}
              <GlassSurface
                testID="algorithm-add-memory"
                state="default"
                radius="pill"
                padding={0}
                onPress={openAddMemory}
                style={styles.addMemoryPill}
                contentStyle={styles.addMemoryContent}
                borderColor={theme.colors.glass.borderActive}
                fillColor={theme.colors.glass.base}
              >
                <Feather name="plus" size={15} color={theme.colors.accent.primary} />
                <ModeText variant="bodySm" tone="accent" style={styles.addMemoryText}>Add memory</ModeText>
              </GlassSurface>
            </View>
            {visibleMemories.length === 0 ? (
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

      <SystemActionSheet
        visible={memoryEditor.visible}
        onClose={closeMemoryEditor}
        testID="algorithm-memory-sheet"
      >
        <View style={styles.sheetTitleRow}>
          <View style={styles.sheetTitleCopy}>
            <ModeText variant="label" tone="tertiary" style={styles.sheetLabel}>
              {memoryEditor.mode === 'edit' ? 'Edit memory' : 'Add memory'}
            </ModeText>
            {memoryEditor.record?.source ? (
              <ModeText variant="caption" tone="secondary">
                {SOURCE_LABELS[memoryEditor.record.source] || 'User'}
              </ModeText>
            ) : null}
          </View>
          <ModeButton
            testID="algorithm-memory-save"
            title={memoryEditor.saving ? 'Saving...' : 'Save'}
            size="sm"
            disabled={isMemoryMutating}
            onPress={handleSaveMemory}
            style={styles.sheetHeaderSaveButton}
          />
        </View>
        <ModeInput
          testID="algorithm-memory-input"
          value={memoryEditor.text}
          onChangeText={(text) => setMemoryEditor((current) => ({ ...current, text }))}
          placeholder="What should your coach remember?"
          multiline
          autoFocus
          editable={!isMemoryMutating}
          style={styles.sheetInput}
        />
        <ModeInput
          testID="algorithm-memory-category-input"
          value={memoryEditor.category}
          onChangeText={(category) => setMemoryEditor((current) => ({ ...current, category }))}
          placeholder="Category (optional)"
          editable={!isMemoryMutating}
        />
        <ModeInput
          testID="algorithm-memory-tags-input"
          value={memoryEditor.tagsText}
          onChangeText={(tagsText) => setMemoryEditor((current) => ({ ...current, tagsText }))}
          placeholder="Tags, comma separated"
          editable={!isMemoryMutating}
        />
        <View style={styles.toggleRow}>
          <View style={styles.toggleCopy}>
            <ModeText variant="bodySm">Use this for coaching</ModeText>
          </View>
          <GlassToggle
            testID="algorithm-memory-ai-toggle"
            value={memoryEditor.aiUsable}
            onValueChange={(aiUsable) => setMemoryEditor((current) => ({ ...current, aiUsable }))}
            disabled={isMemoryMutating}
          />
        </View>
        {memoryEditor.error ? <ModeText variant="caption" tone="error">{memoryEditor.error}</ModeText> : null}
        {memoryEditor.mode === 'edit' && memoryEditor.record?.can_edit ? (
          <View style={styles.sheetActions}>
            <ModeButton
              testID="algorithm-memory-delete"
              title={memoryEditor.deleting ? 'Deleting...' : 'Delete'}
              variant="destructive"
              size="sm"
              disabled={isMemoryMutating}
              onPress={() => handleDeleteMemory(memoryEditor.record)}
              style={styles.sheetDeleteButton}
            />
          </View>
        ) : null}
      </SystemActionSheet>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background.app,
  },
  content: {
    paddingHorizontal: theme.spacing[3],
    alignItems: 'center',
  },
  phoneFrame: {
    width: '100%',
    maxWidth: 390,
    alignSelf: 'center',
    position: 'relative',
  },
  headerBlock: {
    minHeight: 44,
    justifyContent: 'center',
  },
  title: {
    color: theme.colors.text.primary,
    letterSpacing: 0,
  },
  sectionCard: {
    marginTop: theme.spacing[3],
  },
  whyDismissBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0)',
  },
  whyCardEditing: {
    position: 'relative',
    zIndex: 2,
    elevation: 2,
  },
  whyHeaderAction: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  whyHeaderActionPressed: {
    opacity: theme.interaction.pressedOpacity,
    transform: [{ scale: theme.interaction.pressedScale }],
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
  memoryPillWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[1],
    marginTop: theme.spacing[2],
  },
  memoryPill: {
    maxWidth: '100%',
  },
  memoryPillContent: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 10,
    gap: 6,
  },
  memoryPillTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[1],
  },
  memoryPillText: {
    flexShrink: 1,
    fontWeight: '700',
    letterSpacing: 0,
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
    minHeight: 44,
  },
  addMemoryContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 10,
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

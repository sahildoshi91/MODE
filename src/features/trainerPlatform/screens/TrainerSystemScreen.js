import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  ActivityIndicator,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Vibration,
  View,
} from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import Constants from 'expo-constants';

import {
  HeaderBar,
  ModeButton,
  ModeCard,
  ModeChip,
  ModeInput,
  ModeText,
  SafeScreen,
  SystemActionSheet,
  SystemIdentityHeader,
  SystemNavRow,
  SystemSearchBar,
  SystemSectionCard,
  SystemSectionHeader,
} from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import { ATLAS_ADMIN_REVIEW_ENABLED } from '../../../config/featureFlags';
import { getApiDebugInfo } from '../../../services/apiBaseUrl';
import { fetchWithApiFallback } from '../../../services/apiRequest';
import {
  ASSISTANT_DISPLAY_NAME_MAX_LENGTH,
  prepareAssistantDisplayNameForSave,
  resolveAssistantDisplayName,
} from '../../messaging';
import {
  archiveTrainerKnowledgeEntry,
  createTrainerKnowledgeEntry,
  listTrainerKnowledgeEntries,
  refineTrainerKnowledgeEntry,
  updateTrainerKnowledgeEntry,
} from '../../trainerHome/services/trainerKnowledgeApi';
import {
  archiveTrainerClientMemory,
  createTrainerClientMemory,
  listTrainerClientMemory,
  getTrainerClientDetail,
  listTrainerClients,
  removeTrainerClient,
  updateTrainerClientMemory,
  updateTrainerClient,
} from '../../trainerClients/services/trainerHomeApi';
import {
  getTrainerSettingsMe,
  listTrainerPersonas,
  patchTrainerSettingsMe,
} from '../../profile/services/profileApi';
import {
  approveTrainerCoachQueueItem,
  editTrainerCoachQueueItem,
  getTrainerCoachQueue,
  rejectTrainerCoachQueueItem,
} from '../../trainerCoach/services/trainerCoachApi';
import {
  approveTrainerReviewOutput,
  editTrainerReviewOutput,
  getTrainerReviewOutputs,
  rejectTrainerReviewOutput,
} from '../../trainerReview/services/trainerReviewApi';
import {
  approveAtlasAdminReviewQueueItem,
  approveTrainerAiReviewQueueItem,
  deleteTrainerAiReviewQueueItem,
  getAtlasAdminMe,
  getAtlasAdminReviewQueue,
  getTrainerAiReviewQueue,
  rejectAtlasAdminReviewQueueItem,
  rejectTrainerAiReviewQueueItem,
  updateAtlasAdminReviewQueueItem,
  updateTrainerAiReviewQueueItem,
} from '../../atlas/services/atlasApi';
import { formatIsoWeekdaySummary } from '../../trainerClients/utils/scheduleResolver';
import { generateKnowledgeNoteTitle } from '../utils/knowledgeNoteTitleSummary';

const SYSTEM_VIEW = {
  HUB: 'hub',
  COACH_WORKSPACE: 'coach_workspace',
  KNOWLEDGE_WORKSPACE: 'knowledge_workspace',
  DEFAULTS_SESSION: 'defaults_session',
  DEFAULTS_COMMUNICATION: 'defaults_communication',
  CLIENTS_LIST: 'clients_list',
  CLIENT_MANAGEMENT: 'client_management',
  CLIENT_DETAIL_MANAGEMENT: 'client_detail_management',
  REVIEW_HUB: 'review_hub',
  ATLAS_ADMIN_REVIEW: 'atlas_admin_review',
  SYSTEM_ACCOUNT: 'system_account',
};

const REVIEW_SEGMENT = {
  DRAFTS: 'drafts',
  OUTPUTS: 'outputs',
  QA: 'qa',
  AI_LEARNING: 'ai_learning',
};

const MEMORY_FILTER = {
  ALL: 'all',
  AI: 'ai',
  INTERNAL: 'internal',
};

const MEMORY_FILTER_SEGMENTS = [
  { key: MEMORY_FILTER.ALL, label: 'All' },
  { key: MEMORY_FILTER.AI, label: 'AI' },
  { key: MEMORY_FILTER.INTERNAL, label: 'Internal' },
];

const MEMORY_VISIBILITY = {
  AI: 'ai_usable',
  INTERNAL: 'internal_only',
};

const MEMORY_SWIPE_REVEAL_DISTANCE = 72;
const MEMORY_SWIPE_OPEN_THRESHOLD = 32;

const environment = __DEV__ ? 'Development' : 'Production';
const SHOW_ACCOUNT_DIAGNOSTICS = (
  (typeof __DEV__ === 'boolean' && __DEV__)
  || String(process.env.EXPO_PUBLIC_SHOW_ACCOUNT_DIAGNOSTICS || '').trim().toLowerCase() === 'true'
);

function valueOrFallback(value, fallback = 'Not available') {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return fallback;
}

function formatSavedDate(value) {
  if (!value) {
    return 'Date unavailable';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Date unavailable';
  }
  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function formatDateTime(value) {
  if (!value) {
    return 'Not scheduled';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatExceptionDate(value) {
  if (!value) {
    return 'Unknown date';
  }
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function parseTags(inputValue) {
  const seen = new Set();
  return String(inputValue || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => {
      if (!tag) {
        return false;
      }
      const normalized = tag.toLowerCase();
      if (seen.has(normalized)) {
        return false;
      }
      seen.add(normalized);
      return true;
    });
}

function toTitleCase(input) {
  return String(input || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function memoryVisibilityLabel(visibility) {
  return visibility === MEMORY_VISIBILITY.AI ? 'AI' : 'Internal';
}

function resolveMemoryUpdatedAt(record) {
  const parsed = new Date(record?.updated_at || record?.created_at || 0);
  const timestamp = parsed.getTime();
  if (Number.isNaN(timestamp)) {
    return 0;
  }
  return timestamp;
}

function buildMemoryMetaLine(record) {
  const visibility = memoryVisibilityLabel(record?.visibility);
  const parts = [];
  if (visibility) {
    parts.push(visibility);
  }
  const updatedLabel = formatSavedDate(record?.updated_at || record?.created_at);
  if (updatedLabel !== 'Date unavailable') {
    parts.push(updatedLabel);
  }
  return parts.join(' • ');
}

function normalizeListPayload(payload) {
  if (Array.isArray(payload)) {
    return {
      items: payload,
      count: payload.length,
    };
  }
  if (Array.isArray(payload?.items)) {
    return {
      items: payload.items,
      count: typeof payload?.count === 'number' ? payload.count : payload.items.length,
    };
  }
  return {
    items: [],
    count: 0,
  };
}

function buildOnboardingState({
  trainerOnboardingCompleted = false,
  trainerOnboardingStatus = 'not_started',
  trainerOnboardingCompletedSteps = 0,
  trainerOnboardingTotalSteps = 8,
  trainerOnboardingLastStep = null,
}) {
  const totalSteps = Math.max(
    1,
    Number.isFinite(Number(trainerOnboardingTotalSteps)) ? Number(trainerOnboardingTotalSteps) : 8,
  );
  const completedSteps = Math.max(
    0,
    Math.min(
      totalSteps,
      Number.isFinite(Number(trainerOnboardingCompletedSteps)) ? Number(trainerOnboardingCompletedSteps) : 0,
    ),
  );
  const normalizedStatus = typeof trainerOnboardingStatus === 'string'
    ? trainerOnboardingStatus.trim().toLowerCase()
    : 'not_started';
  const onboardingComplete = Boolean(
    trainerOnboardingCompleted || normalizedStatus === 'completed',
  );
  const onboardingInProgress = !onboardingComplete && (
    normalizedStatus === 'in_progress'
    || normalizedStatus === 'calibration_pending'
    || completedSteps > 0
  );
  return {
    onboardingComplete,
    onboardingInProgress,
    completedSteps,
    totalSteps,
    lastStep: trainerOnboardingLastStep,
    primaryAction: onboardingInProgress ? 'resume' : 'continue',
  };
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function firstNonEmptyString(...values) {
  for (let index = 0; index < values.length; index += 1) {
    const candidate = values[index];
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}

function pickDefaultTrainerPersona(payload) {
  if (!Array.isArray(payload) || payload.length === 0) {
    return null;
  }
  return payload.find((row) => row?.is_default) || payload[0];
}

function buildCoachWorkspaceSummary({
  trainerName,
  trainerSettings,
  trainerPersona,
}) {
  const persona = asRecord(trainerPersona);
  const communicationRules = asRecord(persona.communication_rules);
  const onboardingPreferences = asRecord(persona.onboarding_preferences);
  const onboardingAnswers = asRecord(onboardingPreferences.trainer_onboarding_answers);
  const coachingIdentity = asRecord(onboardingAnswers.coaching_identity);
  const tone = asRecord(onboardingAnswers.tone);
  const philosophy = asRecord(onboardingAnswers.philosophy);

  const aiName = firstNonEmptyString(
    coachingIdentity.agent_name,
    persona.persona_name,
    trainerSettings?.assistant_display_name,
    trainerName,
  ) || 'Not set yet';
  const style = firstNonEmptyString(
    coachingIdentity.summary,
    asRecord(communicationRules.identity).summary,
    asRecord(onboardingAnswers.communication_preferences).style,
  ) || 'Not set yet';
  const voice = firstNonEmptyString(
    tone.style,
    persona.tone_description,
  ) || 'Not set yet';
  const soul = firstNonEmptyString(
    philosophy.summary,
    persona.coaching_philosophy,
  ) || 'Not set yet';

  return {
    aiName,
    style,
    voice,
    soul,
  };
}

async function parseApiError(response, fallbackMessage) {
  try {
    const payload = await response.json();
    return payload?.detail || payload?.message || fallbackMessage;
  } catch (_error) {
    return fallbackMessage;
  }
}

async function requestTrainerReviewQueue({ accessToken }) {
  const path = '/api/v1/trainer-review/queue';
  let response;
  try {
    ({ response } = await fetchWithApiFallback(path, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      timeoutMs: 10000,
    }));
  } catch (error) {
    throw error;
  }
  if (!response.ok) {
    throw new Error(await parseApiError(response, 'Unable to load QA queue.'));
  }
  const payload = await response.json();
  return Array.isArray(payload) ? payload : [];
}

async function approveTrainerReviewQueueItem({
  accessToken,
  queueId,
  approvedAnswer,
  responseTags = [],
}) {
  const path = `/api/v1/trainer-review/queue/${encodeURIComponent(queueId)}/approve`;
  let response;
  try {
    ({ response } = await fetchWithApiFallback(path, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        approved_answer: approvedAnswer,
        response_tags: responseTags,
      }),
      timeoutMs: 10000,
    }));
  } catch (error) {
    throw error;
  }
  if (!response.ok) {
    throw new Error(await parseApiError(response, 'Unable to approve QA item.'));
  }
  return response.json();
}

function SectionShell({
  title,
  subtitle,
  onBack = null,
  bottomInset = 0,
  rightSlot = null,
  children,
}) {
  return (
    <SafeScreen
      includeTopInset={false}
      style={styles.screen}
      atmosphere="system"
      atmosphereOverlayStrength={0.94}
    >
      <HeaderBar
        title={title}
        subtitle={subtitle}
        onBack={onBack}
        rightSlot={rightSlot}
      />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: theme.spacing[4] + bottomInset },
        ]}
      >
        {children}
      </ScrollView>
    </SafeScreen>
  );
}

function EmptyListState({ title, detail }) {
  return (
    <View style={styles.emptyState}>
      <ModeText variant="bodySm">{title}</ModeText>
      {detail ? (
        <ModeText variant="caption" tone="secondary">{detail}</ModeText>
      ) : null}
    </View>
  );
}

function DetailRow({ label, value, testID }) {
  return (
    <View style={styles.detailRow} testID={testID}>
      <ModeText variant="caption" tone="tertiary">{label}</ModeText>
      <ModeText variant="bodySm" style={styles.detailValue}>{value}</ModeText>
    </View>
  );
}

function ToggleRow({
  label,
  description,
  value,
  onValueChange,
  testID,
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleCopy}>
        <ModeText variant="bodySm">{label}</ModeText>
        <ModeText variant="caption" tone="secondary">{description}</ModeText>
      </View>
      <Switch
        testID={testID}
        value={value}
        onValueChange={onValueChange}
        thumbColor={theme.colors.text.primary}
        trackColor={{
          false: theme.colors.surface.elevated,
          true: theme.colors.nav.activeBg,
        }}
      />
    </View>
  );
}

function SegmentedControl({ segments, value, onChange }) {
  return (
    <View style={styles.segmentedWrap}>
      {segments.map((segment) => {
        const isActive = segment.key === value;
        return (
          <Pressable
            key={segment.key}
            onPress={() => onChange(segment.key)}
            style={({ pressed }) => [
              styles.segmentButton,
              isActive && styles.segmentButtonActive,
              pressed && styles.segmentButtonPressed,
            ]}
          >
            <ModeText
              variant="caption"
              tone={isActive ? 'primary' : 'secondary'}
              style={styles.segmentLabel}
            >
              {segment.label}
            </ModeText>
          </Pressable>
        );
      })}
    </View>
  );
}

function formatReviewBadge(count) {
  return count > 99 ? '99+' : count;
}

function TrainerSystemHubScreen({
  bottomInset,
  trainerName,
  subtitle,
  counts,
  onboardingState,
  onNavigate,
  showAtlasAdminReview = false,
}) {
  return (
    <SectionShell
      title="System"
      subtitle="Trainer control center"
      bottomInset={bottomInset}
    >
      <SystemIdentityHeader
        name={trainerName}
        subtitle={subtitle}
        clientsCount={counts.clients}
        knowledgeCount={counts.knowledge}
        reviewCount={counts.review}
        testID="trainer-system-identity-header"
      />

      <SystemSectionCard>
        <SystemSectionHeader title="Build" />
        <SystemNavRow
          icon="user"
          title="Coach Workspace"
          subtitle={onboardingState.onboardingComplete
            ? 'Coach profile is calibrated and ready.'
            : onboardingState.onboardingInProgress
              ? `${onboardingState.completedSteps} of ${onboardingState.totalSteps} steps completed`
              : 'Review onboarding progress, coaching identity, and launch actions.'}
          badge={onboardingState.onboardingComplete ? null : `${onboardingState.completedSteps}/${onboardingState.totalSteps}`}
          badgeVariant="accent"
          onPress={() => onNavigate(SYSTEM_VIEW.COACH_WORKSPACE)}
          testID="trainer-system-nav-coach-workspace"
        />
        <SystemNavRow
          icon="database"
          title="Knowledge Workspace"
          subtitle="Notes library for trainer memory and client-facing AI context."
          badge={counts.knowledge > 0 ? counts.knowledge : null}
          badgeVariant="accent"
          onPress={() => onNavigate(SYSTEM_VIEW.KNOWLEDGE_WORKSPACE)}
          testID="trainer-system-nav-knowledge-workspace"
        />
        <SystemNavRow
          icon="users"
          title="Client List"
          subtitle="Open client summaries and detail management."
          badge={counts.clients > 0 ? counts.clients : null}
          badgeVariant="accent"
          onPress={() => onNavigate(SYSTEM_VIEW.CLIENTS_LIST)}
          testID="trainer-system-nav-clients-list"
        />
      </SystemSectionCard>

      <SystemSectionCard>
        <SystemSectionHeader title="Defaults" />
        <SystemNavRow
          icon="calendar"
          title="Trainer Session Defaults"
          subtitle="Default meeting location and session routing rules."
          onPress={() => onNavigate(SYSTEM_VIEW.DEFAULTS_SESSION)}
          testID="trainer-system-nav-defaults-session"
        />
        <SystemNavRow
          icon="message-circle"
          title="Communication Defaults"
          subtitle="Assistant naming and communication identity."
          onPress={() => onNavigate(SYSTEM_VIEW.DEFAULTS_COMMUNICATION)}
          testID="trainer-system-nav-defaults-communication"
        />
      </SystemSectionCard>

      <SystemSectionCard>
        <SystemSectionHeader title="Review" />
        <SystemNavRow
          icon="check-square"
          title="Review Hub"
          subtitle="Draft queue, corrections, and low-confidence QA in one place."
          badge={counts.review > 0 ? formatReviewBadge(counts.review) : null}
          badgeVariant={counts.review > 0 ? 'warning' : 'default'}
          onPress={() => onNavigate(SYSTEM_VIEW.REVIEW_HUB)}
          testID="trainer-system-nav-review-hub"
        />
        {showAtlasAdminReview ? (
          <SystemNavRow
            icon="shield"
            title="Atlas Review"
            subtitle="Internal privacy queue for generalized coaching learnings."
            onPress={() => onNavigate(SYSTEM_VIEW.ATLAS_ADMIN_REVIEW)}
            testID="trainer-system-nav-atlas-review"
          />
        ) : null}
      </SystemSectionCard>

      <SystemSectionCard>
        <SystemSectionHeader title="Account" />
        <SystemNavRow
          icon="shield"
          title="System Account"
          subtitle="Diagnostics, account info, and sign-out."
          onPress={() => onNavigate(SYSTEM_VIEW.SYSTEM_ACCOUNT)}
          testID="trainer-system-nav-system-account"
        />
      </SystemSectionCard>
    </SectionShell>
  );
}

function CoachWorkspaceScreen({
  bottomInset,
  onBack,
  trainerName,
  onboardingState,
  coachSummary,
  onOpenTrainerCoach,
}) {
  const statusLabel = onboardingState.onboardingComplete
    ? 'Completed'
    : onboardingState.onboardingInProgress
      ? 'In progress'
      : 'Not started';

  return (
    <SectionShell
      title="Coach Workspace"
      subtitle="Onboarding progress, coaching profile summary, and launch actions in one place."
      onBack={onBack}
      bottomInset={bottomInset}
    >
      <ModeCard variant="hero">
        <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>Onboarding</ModeText>
        <DetailRow label="Trainer" value={trainerName} />
        <DetailRow label="Status" value={statusLabel} />
        <DetailRow
          label="Progress"
          value={`${onboardingState.completedSteps} of ${onboardingState.totalSteps} steps completed`}
        />
        {onboardingState.lastStep ? (
          <DetailRow
            label="Last step"
            value={String(onboardingState.lastStep).replace(/_/g, ' ')}
          />
        ) : null}
      </ModeCard>

      <ModeCard variant="surface">
        <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>Coach Summary</ModeText>
        <DetailRow label="AI Name" value={valueOrFallback(coachSummary?.aiName, 'Not set yet')} />
        <DetailRow label="Style" value={valueOrFallback(coachSummary?.style, 'Not set yet')} />
        <DetailRow label="Voice" value={valueOrFallback(coachSummary?.voice, 'Not set yet')} />
        <DetailRow label="Soul / Philosophy" value={valueOrFallback(coachSummary?.soul, 'Not set yet')} />
      </ModeCard>

      <ModeCard variant="surface">
        <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>Actions</ModeText>
        <ModeText variant="bodySm" tone="secondary">
          Review your onboarding summary first, then resume or retrain when needed.
        </ModeText>
        <View style={styles.buttonStack}>
          <ModeButton
            title="Review Coach Onboarding"
            onPress={() => onOpenTrainerCoach?.({
              entrypoint: 'trainer_agent_training',
              onboarding_action: 'review',
            })}
            testID="trainer-system-coach-workspace-review"
          />
          {!onboardingState.onboardingComplete ? (
            <ModeButton
              title="Resume Coach Onboarding"
              variant="secondary"
              onPress={() => onOpenTrainerCoach?.({
                entrypoint: 'trainer_agent_training',
                onboarding_action: 'resume',
              })}
              testID="trainer-system-coach-workspace-resume"
            />
          ) : null}
          <ModeButton
            title="Retrain Coach"
            variant="ghost"
            onPress={() => onOpenTrainerCoach?.({
              entrypoint: 'trainer_agent_training',
              onboarding_action: 'retrain',
            })}
            testID="trainer-system-coach-workspace-retrain"
          />
        </View>
      </ModeCard>
    </SectionShell>
  );
}

const KNOWLEDGE_FILTER = {
  ALL: 'all',
  GLOBAL: 'global',
  CLIENT: 'client_specific',
  AI: 'ai_enabled',
  ARCHIVED: 'archived',
};

const KNOWLEDGE_FILTER_SEGMENTS = [
  { key: KNOWLEDGE_FILTER.ALL, label: 'All' },
  { key: KNOWLEDGE_FILTER.GLOBAL, label: 'Global' },
  { key: KNOWLEDGE_FILTER.CLIENT, label: 'Client-specific' },
  { key: KNOWLEDGE_FILTER.AI, label: 'AI enabled' },
  { key: KNOWLEDGE_FILTER.ARCHIVED, label: 'Archived' },
];

const KNOWLEDGE_SCOPE_SEGMENTS = [
  { key: 'global', label: 'Global' },
  { key: 'client_specific', label: 'Client-specific' },
];

const KNOWLEDGE_TYPE_OPTIONS = [
  { key: 'coaching_rule', label: 'Coaching Rule' },
  { key: 'programming_preference', label: 'Programming Preference' },
  { key: 'nutrition_principle', label: 'Nutrition Principle' },
  { key: 'client_pattern', label: 'Client Pattern' },
  { key: 'communication_style', label: 'Communication Style' },
  { key: 'business_policy', label: 'Business / Policy' },
  { key: 'other', label: 'Other' },
];

function normalizeKnowledgeEntry(document) {
  return {
    id: document?.id || null,
    trainer_id: document?.trainer_id || null,
    client_id: document?.client_id || null,
    title: String(document?.title || ''),
    raw_content: String(document?.raw_content || ''),
    structured_summary: String(document?.structured_summary || ''),
    knowledge_type: String(document?.knowledge_type || 'other'),
    scope: String(document?.scope || 'global'),
    tags: Array.isArray(document?.tags) ? document.tags : [],
    ai_enabled: document?.ai_enabled !== false,
    status: String(document?.status || 'active'),
    updated_at: document?.updated_at || document?.created_at || null,
    created_at: document?.created_at || null,
    archived_at: document?.archived_at || null,
    metadata: document?.metadata || {},
  };
}

function knowledgeTypeLabel(value) {
  const normalized = String(value || 'other');
  const option = KNOWLEDGE_TYPE_OPTIONS.find((item) => item.key === normalized);
  return option?.label || 'Other';
}

function noteRowDisplayTitle(document) {
  const explicitTitle = String(document?.title || '').trim();
  if (explicitTitle) {
    return explicitTitle;
  }
  return generateKnowledgeNoteTitle(document?.raw_content || '');
}

function buildKnowledgeNoteSubtitle(document) {
  const scopeLabel = document?.scope === 'client_specific' ? 'Client' : 'Global';
  const aiLabel = document?.ai_enabled === false ? 'AI Off' : 'AI On';
  return `${knowledgeTypeLabel(document?.knowledge_type)} · ${scopeLabel} · ${aiLabel} · ${formatSavedDate(document?.updated_at)}`;
}

function KnowledgeWorkspaceScreen({
  accessToken,
  bottomInset,
  onBack,
  onKnowledgeMutated,
}) {
  const [entries, setEntries] = useState([]);
  const [query, setQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState(KNOWLEDGE_FILTER.ALL);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftRawText, setDraftRawText] = useState('');
  const [draftScope, setDraftScope] = useState('global');
  const [draftKnowledgeType, setDraftKnowledgeType] = useState('coaching_rule');
  const [draftTags, setDraftTags] = useState('');
  const [draftAiEnabled, setDraftAiEnabled] = useState(true);
  const [refinementAction, setRefinementAction] = useState(null);
  const [refinementDraft, setRefinementDraft] = useState('');
  const [mutationState, setMutationState] = useState({
    isSaving: false,
    archivingId: null,
    error: null,
    errorEntryId: null,
    success: null,
    conflictWarning: null,
    aiDisabledWarning: null,
  });

  const closeSheet = useCallback(() => {
    setSelectedEntry(null);
    setIsEditing(false);
    setIsCreating(false);
    setDraftTitle('');
    setDraftRawText('');
    setDraftScope('global');
    setDraftKnowledgeType('coaching_rule');
    setDraftTags('');
    setDraftAiEnabled(true);
    setRefinementAction(null);
    setRefinementDraft('');
    setMutationState((current) => ({
      ...current,
      isSaving: false,
      error: null,
      errorEntryId: null,
      success: null,
      conflictWarning: null,
      aiDisabledWarning: null,
    }));
  }, []);

  const loadEntries = useCallback(async ({ refresh = false } = {}) => {
    if (!accessToken) {
      setEntries([]);
      setIsLoading(false);
      return;
    }
    if (refresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setLoadError(null);
    try {
      const payload = await listTrainerKnowledgeEntries({
        accessToken,
        includeArchived: true,
        limit: 220,
        offset: 0,
      });
      const normalized = Array.isArray(payload)
        ? payload.map((item) => normalizeKnowledgeEntry(item))
        : [];
      setEntries(normalized);
    } catch (nextError) {
      setLoadError(nextError?.message || 'Unable to load knowledge entries.');
    } finally {
      if (refresh) {
        setIsRefreshing(false);
      } else {
        setIsLoading(false);
      }
    }
  }, [accessToken]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  const filteredEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = entries.filter((entry) => {
      if (activeFilter === KNOWLEDGE_FILTER.GLOBAL && entry.scope !== 'global') {
        return false;
      }
      if (activeFilter === KNOWLEDGE_FILTER.CLIENT && entry.scope !== 'client_specific') {
        return false;
      }
      if (activeFilter === KNOWLEDGE_FILTER.AI && entry.ai_enabled !== true) {
        return false;
      }
      if (activeFilter === KNOWLEDGE_FILTER.ARCHIVED && entry.status !== 'archived') {
        return false;
      }
      if (activeFilter !== KNOWLEDGE_FILTER.ARCHIVED && entry.status === 'archived') {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      const tags = Array.isArray(entry.tags) ? entry.tags.join(' ') : '';
      const clientName = String(entry?.metadata?.client_name || '');
      const searchable = `${entry.title} ${entry.raw_content} ${tags} ${clientName}`.toLowerCase();
      return searchable.includes(normalizedQuery);
    });
    return [...filtered].sort((left, right) => (
      String(right.updated_at || '').localeCompare(String(left.updated_at || ''))
    ));
  }, [activeFilter, entries, query]);

  const openEntry = useCallback((entry, { editing = false } = {}) => {
    const normalized = normalizeKnowledgeEntry(entry);
    setSelectedEntry(normalized);
    setIsCreating(false);
    setIsEditing(editing);
    setDraftTitle(String(normalized.title || ''));
    setDraftRawText(String(normalized.raw_content || ''));
    setDraftScope(normalized.scope || 'global');
    setDraftKnowledgeType(normalized.knowledge_type || 'other');
    setDraftTags(Array.isArray(normalized.tags) ? normalized.tags.join(', ') : '');
    setDraftAiEnabled(normalized.ai_enabled !== false);
    setMutationState((current) => ({
      ...current,
      error: null,
      errorEntryId: null,
      success: null,
      conflictWarning: null,
      aiDisabledWarning: null,
    }));
  }, []);

  const handleOpenNewKnowledge = useCallback(() => {
    setSelectedEntry({
      id: null,
      title: '',
      raw_content: '',
      knowledge_type: 'coaching_rule',
      scope: 'global',
      tags: [],
      ai_enabled: true,
      status: 'active',
      updated_at: null,
      created_at: null,
      metadata: { source: 'trainer_system_workspace' },
    });
    setIsCreating(true);
    setIsEditing(true);
    setDraftTitle('');
    setDraftRawText('');
    setDraftScope('global');
    setDraftKnowledgeType('coaching_rule');
    setDraftTags('');
    setDraftAiEnabled(true);
    setMutationState((current) => ({
      ...current,
      error: null,
      errorEntryId: null,
      success: null,
      conflictWarning: null,
      aiDisabledWarning: null,
    }));
  }, []);

  const handleSaveEntry = useCallback(async () => {
    if (!accessToken || mutationState.isSaving || !selectedEntry) {
      return;
    }
    const normalizedRawText = draftRawText.trim();
    if (!normalizedRawText) {
      setMutationState((current) => ({
        ...current,
        error: 'Add note content before saving.',
      }));
      return;
    }
    const resolvedTitle = draftTitle.trim() || generateKnowledgeNoteTitle(normalizedRawText);
    const parsedTags = parseTags(draftTags);
    setMutationState((current) => ({
      ...current,
      isSaving: true,
      error: null,
      errorEntryId: null,
      success: null,
      conflictWarning: null,
      aiDisabledWarning: null,
    }));
    try {
      const payload = isCreating || !selectedEntry?.id
        ? await createTrainerKnowledgeEntry({
          accessToken,
          title: resolvedTitle,
          rawContent: normalizedRawText,
          knowledgeType: draftKnowledgeType,
          scope: draftScope,
          tags: parsedTags,
          aiEnabled: draftAiEnabled,
          source: 'manual_note',
          metadata: selectedEntry?.metadata || { source: 'trainer_system_workspace' },
        })
        : await updateTrainerKnowledgeEntry({
          accessToken,
          entryId: selectedEntry.id,
          title: resolvedTitle,
          rawContent: normalizedRawText,
          knowledgeType: draftKnowledgeType,
          scope: draftScope,
          tags: parsedTags,
          aiEnabled: draftAiEnabled,
          metadata: selectedEntry?.metadata || {},
          changeReason: 'Trainer edited knowledge entry',
        });
      const updated = normalizeKnowledgeEntry(payload?.entry || payload);
      setEntries((current) => {
        const withoutDuplicate = current.filter((entry) => entry?.id !== updated?.id);
        return [updated, ...withoutDuplicate];
      });
      setSelectedEntry(updated);
      setDraftTitle(String(updated?.title || resolvedTitle));
      setDraftRawText(String(updated?.raw_content || normalizedRawText));
      setIsEditing(false);
      setIsCreating(false);
      setMutationState((current) => ({
        ...current,
        isSaving: false,
        success: isCreating ? 'Knowledge saved.' : 'Knowledge updated.',
        conflictWarning: Array.isArray(payload?.conflicts) && payload.conflicts.length > 0
          ? 'This may conflict with an existing coaching rule.'
          : null,
        aiDisabledWarning: payload?.safety?.ai_enabled_forced_off
          ? 'This was saved, but AI usage is off until reviewed.'
          : null,
      }));
      onKnowledgeMutated?.();
    } catch (nextError) {
      setMutationState((current) => ({
        ...current,
        isSaving: false,
        error: nextError?.message || 'Unable to save knowledge.',
      }));
    }
  }, [
    accessToken,
    draftAiEnabled,
    draftKnowledgeType,
    draftRawText,
    draftScope,
    draftTags,
    draftTitle,
    isCreating,
    mutationState.isSaving,
    onKnowledgeMutated,
    selectedEntry,
  ]);

  const handleArchiveEntry = useCallback(async (entryId) => {
    if (!entryId || !accessToken || mutationState.archivingId || mutationState.isSaving) {
      return;
    }
    setMutationState((current) => ({
      ...current,
      archivingId: entryId,
      error: null,
      errorEntryId: null,
      success: null,
    }));
    try {
      const payload = await archiveTrainerKnowledgeEntry({
        accessToken,
        entryId,
      });
      const archivedEntry = normalizeKnowledgeEntry(payload?.entry || payload);
      setEntries((current) => current.map((entry) => (
        entry?.id === entryId
          ? { ...entry, status: 'archived', ai_enabled: false, archived_at: archivedEntry?.archived_at || new Date().toISOString() }
          : entry
      )));
      setMutationState((current) => ({
        ...current,
        archivingId: null,
        success: 'Knowledge archived.',
      }));
      if (selectedEntry?.id === entryId) {
        closeSheet();
      }
      onKnowledgeMutated?.();
    } catch (nextError) {
      setMutationState((current) => ({
        ...current,
        archivingId: null,
        error: nextError?.message || 'Unable to archive entry.',
        errorEntryId: entryId,
      }));
    }
  }, [accessToken, closeSheet, mutationState.archivingId, mutationState.isSaving, onKnowledgeMutated, selectedEntry?.id]);

  const applyRefinement = useCallback(async () => {
    if (!accessToken || !selectedEntry?.id || !refinementAction || !refinementDraft.trim()) {
      return;
    }
    setMutationState((current) => ({
      ...current,
      isSaving: true,
      error: null,
      success: null,
    }));
    try {
      const payload = await refineTrainerKnowledgeEntry({
        accessToken,
        entryId: selectedEntry.id,
        action: refinementAction,
        content: refinementDraft.trim(),
        changeReason: `Refinement action: ${refinementAction}`,
      });
      const updated = normalizeKnowledgeEntry(payload?.entry || payload);
      setEntries((current) => {
        const withoutCurrent = current.filter((entry) => entry.id !== updated.id);
        return [updated, ...withoutCurrent];
      });
      setSelectedEntry(updated);
      setDraftTitle(String(updated.title || ''));
      setDraftRawText(String(updated.raw_content || ''));
      setIsEditing(false);
      setRefinementAction(null);
      setRefinementDraft('');
      setMutationState((current) => ({
        ...current,
        isSaving: false,
        success: 'Refinement applied.',
      }));
      onKnowledgeMutated?.();
    } catch (error) {
      setMutationState((current) => ({
        ...current,
        isSaving: false,
        error: error?.message || 'Unable to apply refinement.',
      }));
    }
  }, [accessToken, onKnowledgeMutated, refinementAction, refinementDraft, selectedEntry]);

  return (
    <SectionShell
      title="Knowledge Workspace"
      subtitle="Trainer knowledge for AI memory and coaching context."
      onBack={onBack}
      bottomInset={bottomInset}
    >
      <View style={styles.knowledgeWorkspaceTopActions}>
        <ModeButton
          title="New Knowledge"
          size="sm"
          onPress={handleOpenNewKnowledge}
          testID="trainer-system-notes-new"
        />
        <ModeButton
          title={isRefreshing ? 'Refreshing...' : 'Refresh'}
          size="sm"
          variant="ghost"
          onPress={() => loadEntries({ refresh: true })}
          disabled={isLoading || isRefreshing}
          testID="trainer-system-notes-refresh"
        />
      </View>

      <SystemSearchBar
        value={query}
        onChangeText={setQuery}
        placeholder="Search title, content, tags, client"
        testID="trainer-system-notes-search"
      />
      <View style={styles.chipRow}>
        {KNOWLEDGE_FILTER_SEGMENTS.map((segment) => (
          <ModeChip
            key={segment.key}
            label={segment.label}
            selected={activeFilter === segment.key}
            onPress={() => setActiveFilter(segment.key)}
            testID={`trainer-system-knowledge-filter-${segment.key}`}
          />
        ))}
      </View>

      <SystemSectionCard>
        <SystemSectionHeader title="Knowledge Library" />
        {isLoading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={theme.colors.brand.progressCore} />
            <ModeText variant="bodySm" tone="secondary">Loading knowledge...</ModeText>
          </View>
        ) : null}
        {!isLoading && loadError ? (
          <ModeText variant="bodySm" tone="error">{loadError}</ModeText>
        ) : null}
        {!isLoading && !loadError && filteredEntries.length === 0 ? (
          <EmptyListState
            title="Your coaching knowledge will live here."
            detail="Add rules, preferences, and patterns your AI should remember."
          />
        ) : null}
        {!isLoading && !loadError && filteredEntries.length > 0 ? filteredEntries.map((entry, index) => {
          const entryId = entry?.id || `entry-${index}`;
          const isArchiving = mutationState.archivingId === entryId;
          const hasArchiveError = mutationState.errorEntryId === entryId && Boolean(mutationState.error);
          return (
            <View
              key={entry?.id || `${entry?.title || 'entry'}-${index}`}
              style={styles.noteRowGroup}
            >
              <Pressable
                style={({ pressed }) => [
                  styles.noteRow,
                  pressed && styles.noteRowPressed,
                ]}
                onPress={() => openEntry(entry)}
                testID={`trainer-system-note-row-${entryId}`}
                accessibilityRole="button"
                accessibilityLabel="Open knowledge details"
              >
                <View style={styles.noteRowCopy}>
                  <ModeText variant="bodySm" style={styles.noteRowTitle} numberOfLines={1}>
                    {noteRowDisplayTitle(entry)}
                  </ModeText>
                  <ModeText variant="caption" tone="secondary" numberOfLines={1}>
                    {buildKnowledgeNoteSubtitle(entry)}
                  </ModeText>
                </View>
                <View style={styles.noteRowActions}>
                  <Pressable
                    testID={`trainer-system-note-edit-${entryId}`}
                    onPress={(event) => {
                      event?.stopPropagation?.();
                      openEntry(entry, { editing: true });
                    }}
                    style={({ pressed }) => [
                      styles.noteRowIconButton,
                      pressed && styles.noteRowIconButtonPressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Edit knowledge"
                    hitSlop={8}
                  >
                    <Feather name="edit-2" size={14} color={theme.colors.text.secondary} />
                  </Pressable>
                  <Pressable
                    testID={`trainer-system-note-delete-${entryId}`}
                    onPress={(event) => {
                      event?.stopPropagation?.();
                      handleArchiveEntry(entry?.id);
                    }}
                    style={({ pressed }) => [
                      styles.noteRowIconButton,
                      pressed && styles.noteRowIconButtonPressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Archive knowledge"
                    hitSlop={8}
                    disabled={isArchiving || entry?.status === 'archived'}
                  >
                    {isArchiving ? (
                      <ActivityIndicator size="small" color={theme.colors.text.secondary} />
                    ) : (
                      <Feather name="archive" size={14} color={theme.colors.text.secondary} />
                    )}
                  </Pressable>
                </View>
              </Pressable>
              {hasArchiveError ? (
                <ModeText variant="caption" tone="error">{mutationState.error}</ModeText>
              ) : null}
            </View>
          );
        }) : null}
      </SystemSectionCard>

      <SystemActionSheet
        visible={Boolean(selectedEntry)}
        onClose={closeSheet}
        testID="trainer-system-notes-sheet"
      >
        {selectedEntry ? (
          <View style={styles.sheetContent}>
            <ModeText variant="label" tone="tertiary">{isCreating ? 'New Knowledge' : 'Knowledge Detail'}</ModeText>
            {!isEditing ? (
              <>
                <ModeText variant="bodySm" style={styles.sheetTitle}>
                  {noteRowDisplayTitle(selectedEntry)}
                </ModeText>
                <ModeText variant="caption" tone="tertiary">
                  {buildKnowledgeNoteSubtitle(selectedEntry)}
                </ModeText>
                <ModeText variant="bodySm" tone="secondary">
                  {selectedEntry.raw_content || 'No content available for this entry.'}
                </ModeText>
              </>
            ) : (
              <>
                <ModeInput
                  value={draftTitle}
                  onChangeText={setDraftTitle}
                  placeholder="Optional title"
                  testID="trainer-system-note-sheet-title-input"
                />
                <ModeInput
                  value={draftRawText}
                  onChangeText={setDraftRawText}
                  placeholder="Add coaching knowledge..."
                  multiline
                  style={styles.multilineInput}
                  testID="trainer-system-note-sheet-raw-input"
                />
                <View style={styles.chipRow}>
                  {KNOWLEDGE_SCOPE_SEGMENTS.map((scopeOption) => (
                    <ModeChip
                      key={scopeOption.key}
                      label={scopeOption.label}
                      selected={draftScope === scopeOption.key}
                      onPress={() => setDraftScope(scopeOption.key)}
                      testID={`trainer-system-knowledge-scope-${scopeOption.key}`}
                    />
                  ))}
                </View>
                <View style={styles.chipRow}>
                  {KNOWLEDGE_TYPE_OPTIONS.map((typeOption) => (
                    <ModeChip
                      key={typeOption.key}
                      label={typeOption.label}
                      selected={draftKnowledgeType === typeOption.key}
                      onPress={() => setDraftKnowledgeType(typeOption.key)}
                      testID={`trainer-system-knowledge-type-${typeOption.key}`}
                    />
                  ))}
                </View>
                <ModeInput
                  value={draftTags}
                  onChangeText={setDraftTags}
                  placeholder="Tags (comma-separated)"
                  testID="trainer-system-knowledge-tags"
                />
                <ToggleRow
                  label="Use this to inform AI coaching"
                  value={draftAiEnabled}
                  onValueChange={setDraftAiEnabled}
                  testID="trainer-system-knowledge-ai-toggle"
                />
              </>
            )}
            {mutationState.error && !mutationState.errorEntryId ? (
              <ModeText variant="caption" tone="error">{mutationState.error}</ModeText>
            ) : null}
            {mutationState.conflictWarning ? (
              <ModeText variant="caption" tone="secondary">{mutationState.conflictWarning}</ModeText>
            ) : null}
            {mutationState.aiDisabledWarning ? (
              <ModeText variant="caption" tone="secondary">{mutationState.aiDisabledWarning}</ModeText>
            ) : null}
            {mutationState.success ? (
              <ModeText variant="caption" tone="success">{mutationState.success}</ModeText>
            ) : null}

            {!isCreating && selectedEntry?.id ? (
              <View style={styles.refinementActions}>
                <ModeButton
                  title="Add example"
                  variant="ghost"
                  size="sm"
                  onPress={() => setRefinementAction('add_example')}
                />
                <ModeButton
                  title="Add exception"
                  variant="ghost"
                  size="sm"
                  onPress={() => setRefinementAction('add_exception')}
                />
                <ModeButton
                  title="Clarify rule"
                  variant="ghost"
                  size="sm"
                  onPress={() => setRefinementAction('clarify_rule')}
                />
              </View>
            ) : null}

            {refinementAction ? (
              <View style={styles.refinementComposer}>
                <ModeInput
                  value={refinementDraft}
                  onChangeText={setRefinementDraft}
                  placeholder="Add refinement detail"
                  multiline
                  style={styles.multilineInputCompact}
                  testID="trainer-system-knowledge-refine-input"
                />
                <View style={styles.buttonStack}>
                  <ModeButton
                    title={mutationState.isSaving ? 'Saving...' : 'Apply refinement'}
                    onPress={applyRefinement}
                    disabled={mutationState.isSaving || !refinementDraft.trim()}
                    testID="trainer-system-knowledge-refine-apply"
                  />
                  <ModeButton
                    title="Cancel refinement"
                    variant="ghost"
                    onPress={() => {
                      setRefinementAction(null);
                      setRefinementDraft('');
                    }}
                    disabled={mutationState.isSaving}
                  />
                </View>
              </View>
            ) : null}

            {!isEditing ? (
              <View style={styles.buttonStack}>
                <ModeButton
                  title="Edit knowledge"
                  variant="secondary"
                  onPress={() => setIsEditing(true)}
                  testID="trainer-system-note-sheet-edit"
                />
                <ModeButton
                  title="Archive"
                  variant="ghost"
                  onPress={() => handleArchiveEntry(selectedEntry.id)}
                  testID="trainer-system-note-sheet-archive"
                />
                <ModeButton
                  title="Close"
                  variant="ghost"
                  onPress={closeSheet}
                  testID="trainer-system-note-sheet-close"
                />
              </View>
            ) : (
              <View style={styles.buttonStack}>
                <ModeButton
                  title={mutationState.isSaving ? 'Saving...' : isCreating ? 'Save to knowledge' : 'Save changes'}
                  onPress={handleSaveEntry}
                  disabled={mutationState.isSaving}
                  testID="trainer-system-note-sheet-save"
                />
                <ModeButton
                  title="Cancel"
                  variant="ghost"
                  onPress={() => {
                    if (isCreating) {
                      closeSheet();
                      return;
                    }
                    setIsEditing(false);
                    setDraftTitle(String(selectedEntry?.title || ''));
                    setDraftRawText(String(selectedEntry?.raw_content || ''));
                    setDraftScope(String(selectedEntry?.scope || 'global'));
                    setDraftKnowledgeType(String(selectedEntry?.knowledge_type || 'other'));
                    setDraftTags(Array.isArray(selectedEntry?.tags) ? selectedEntry.tags.join(', ') : '');
                    setDraftAiEnabled(selectedEntry?.ai_enabled !== false);
                    setMutationState((current) => ({
                      ...current,
                      error: null,
                      errorEntryId: null,
                      success: null,
                    }));
                  }}
                  disabled={mutationState.isSaving}
                  testID="trainer-system-note-sheet-cancel"
                />
              </View>
            )}
          </View>
        ) : null}
      </SystemActionSheet>
    </SectionShell>
  );
}
function DefaultsSessionScreen({
  accessToken,
  bottomInset,
  onBack,
  trainerSettings,
  isLoadingTrainerSettings,
  onTrainerSettingsSaved,
}) {
  const [defaultMeetingLocation, setDefaultMeetingLocation] = useState('');
  const [autoFillMeetingLocation, setAutoFillMeetingLocation] = useState(true);
  const [status, setStatus] = useState({ error: null, success: null, isSaving: false });

  useEffect(() => {
    setDefaultMeetingLocation(String(trainerSettings?.default_meeting_location || ''));
    setAutoFillMeetingLocation(trainerSettings?.auto_fill_meeting_location !== false);
  }, [trainerSettings]);

  const handleSave = async () => {
    if (!accessToken || status.isSaving) {
      return;
    }
    setStatus({ error: null, success: null, isSaving: true });
    try {
      const payload = await patchTrainerSettingsMe({
        accessToken,
        defaultMeetingLocation: String(defaultMeetingLocation || '').trim() || null,
        autoFillMeetingLocation: Boolean(autoFillMeetingLocation),
      });
      onTrainerSettingsSaved?.(payload);
      setStatus({ error: null, success: 'Trainer session defaults saved.', isSaving: false });
    } catch (error) {
      setStatus({
        error: error?.message || 'Unable to save trainer settings.',
        success: null,
        isSaving: false,
      });
    }
  };

  return (
    <SectionShell
      title="Trainer Session Defaults"
      subtitle="Centralize how your workspace resolves default session behavior."
      onBack={onBack}
      bottomInset={bottomInset}
    >
      <ModeCard variant="surface">
        <ModeInput
          value={defaultMeetingLocation}
          onChangeText={setDefaultMeetingLocation}
          placeholder="Default meeting location"
          testID="trainer-system-defaults-session-location"
        />
        <ToggleRow
          label="Auto-fill for client sessions"
          description="Use your trainer default when a client has no override."
          value={autoFillMeetingLocation}
          onValueChange={setAutoFillMeetingLocation}
          testID="trainer-system-defaults-session-auto-fill"
        />
        {isLoadingTrainerSettings ? (
          <ModeText variant="caption" tone="secondary">Loading trainer defaults...</ModeText>
        ) : null}
        {status.error ? (
          <ModeText variant="caption" tone="error">{status.error}</ModeText>
        ) : null}
        {status.success ? (
          <ModeText variant="caption" tone="success">{status.success}</ModeText>
        ) : null}
        <ModeButton
          title={status.isSaving ? 'Saving...' : 'Save session defaults'}
          onPress={handleSave}
          disabled={status.isSaving || isLoadingTrainerSettings}
          testID="trainer-system-defaults-session-save"
        />
      </ModeCard>
    </SectionShell>
  );
}

function DefaultsCommunicationScreen({
  accessToken,
  bottomInset,
  onBack,
  trainerSettings,
  isLoadingTrainerSettings,
  onTrainerSettingsSaved,
}) {
  const [assistantDisplayName, setAssistantDisplayName] = useState('');
  const [status, setStatus] = useState({ error: null, success: null, isSaving: false });

  useEffect(() => {
    setAssistantDisplayName(String(trainerSettings?.assistant_display_name || ''));
  }, [trainerSettings]);

  const resolvedAssistantPreviewName = useMemo(
    () => resolveAssistantDisplayName(assistantDisplayName),
    [assistantDisplayName],
  );
  const characterCount = String(assistantDisplayName || '').trim().length;

  const handleSave = async () => {
    if (!accessToken || status.isSaving) {
      return;
    }
    setStatus({ error: null, success: null, isSaving: true });
    try {
      const payload = await patchTrainerSettingsMe({
        accessToken,
        assistantDisplayName: prepareAssistantDisplayNameForSave(assistantDisplayName),
      });
      onTrainerSettingsSaved?.(payload);
      setStatus({ error: null, success: 'Communication defaults saved.', isSaving: false });
    } catch (error) {
      setStatus({
        error: error?.message || 'Unable to save assistant name.',
        success: null,
        isSaving: false,
      });
    }
  };

  return (
    <SectionShell
      title="Communication Defaults"
      subtitle="Set how your assistant is named across the trainer workspace."
      onBack={onBack}
      bottomInset={bottomInset}
    >
      <ModeCard variant="surface">
        <ModeInput
          value={assistantDisplayName}
          onChangeText={setAssistantDisplayName}
          placeholder="Coach AI"
          maxLength={ASSISTANT_DISPLAY_NAME_MAX_LENGTH}
          testID="trainer-system-defaults-communication-name"
        />
        <View style={styles.assistantPreviewCard}>
          <View style={styles.assistantPreviewRow}>
            <ModeText variant="caption" tone="tertiary">Trainer</ModeText>
            <ModeText variant="caption" tone="tertiary">{resolvedAssistantPreviewName}</ModeText>
          </View>
          <ModeText variant="caption" tone="secondary">
            Preview: Trainer and {resolvedAssistantPreviewName}
          </ModeText>
        </View>
        <ModeText variant="caption" tone="tertiary">
          {`${characterCount}/${ASSISTANT_DISPLAY_NAME_MAX_LENGTH} characters`}
        </ModeText>
        {isLoadingTrainerSettings ? (
          <ModeText variant="caption" tone="secondary">Loading communication defaults...</ModeText>
        ) : null}
        {status.error ? (
          <ModeText variant="caption" tone="error">{status.error}</ModeText>
        ) : null}
        {status.success ? (
          <ModeText variant="caption" tone="success">{status.success}</ModeText>
        ) : null}
        <ModeButton
          title={status.isSaving ? 'Saving...' : 'Save communication defaults'}
          onPress={handleSave}
          disabled={status.isSaving || isLoadingTrainerSettings}
          testID="trainer-system-defaults-communication-save"
        />
      </ModeCard>
    </SectionShell>
  );
}

function ClientsListScreen({
  accessToken,
  bottomInset,
  onBack,
  onOpenClientDetail,
  onOpenClientManagement,
}) {
  const [query, setQuery] = useState('');
  const [payload, setPayload] = useState({ items: [], count: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadClients = useCallback(async () => {
    if (!accessToken) {
      setPayload({ items: [], count: 0 });
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const response = await listTrainerClients({
        accessToken,
        query,
        limit: 100,
        offset: 0,
      });
      setPayload(normalizeListPayload(response));
    } catch (nextError) {
      setError(nextError?.message || 'Unable to load clients.');
    } finally {
      setIsLoading(false);
    }
  }, [accessToken, query]);

  useEffect(() => {
    loadClients();
  }, [loadClients]);

  return (
    <SectionShell
      title="Client List"
      subtitle="Compact entry point into assigned clients and management detail."
      onBack={onBack}
      bottomInset={bottomInset}
      rightSlot={(
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open client management"
          hitSlop={8}
          onPress={onOpenClientManagement}
          testID="trainer-system-clients-manage"
          style={({ pressed }) => [
            styles.headerIconButton,
            pressed && styles.headerIconButtonPressed,
          ]}
        >
          <Feather name="user-plus" size={16} color={theme.colors.text.primary} />
        </Pressable>
      )}
    >
      <SystemSearchBar
        value={query}
        onChangeText={setQuery}
        placeholder="Search clients"
        testID="trainer-system-clients-search"
      />
      <SystemSectionCard>
        <SystemSectionHeader
          title="Assigned Clients"
          trailing={(
            <ModeText variant="caption" tone="secondary">
              {payload.count} total
            </ModeText>
          )}
        />
        {isLoading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={theme.colors.brand.progressCore} />
            <ModeText variant="bodySm" tone="secondary">Loading clients...</ModeText>
          </View>
        ) : null}
        {!isLoading && error ? (
          <ModeText variant="bodySm" tone="error">{error}</ModeText>
        ) : null}
        {!isLoading && !error && payload.items.length === 0 ? (
          <EmptyListState
            title="No assigned clients"
            detail="Use the Clients tab to create an invite code and share it with your client."
          />
        ) : null}
        {!isLoading && !error && payload.items.length > 0 ? payload.items.map((client) => (
          <SystemNavRow
            key={client.client_id || client.id}
            icon="user"
            title={client.client_name || 'Unnamed client'}
            subtitle={client.user_id || client.client_id || 'Client'}
            onPress={() => onOpenClientDetail(client.client_id || client.id)}
            testID={`trainer-system-client-row-${client.client_id || client.id}`}
          />
        )) : null}
      </SystemSectionCard>
    </SectionShell>
  );
}

function ClientManagementScreen({
  accessToken,
  bottomInset,
  onBack,
  onOpenClientDetail,
  onClientsMutated,
}) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [clientsPayload, setClientsPayload] = useState({ items: [], count: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedClient, setSelectedClient] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [clientMutationState, setClientMutationState] = useState({
    isSaving: false,
    isRemoving: false,
    error: null,
  });

  const loadData = useCallback(async () => {
    if (!accessToken) {
      setClientsPayload({ items: [], count: 0 });
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const clientsResponse = await listTrainerClients({
        accessToken,
        query: debouncedQuery,
        limit: 100,
        offset: 0,
      });
      setClientsPayload(normalizeListPayload(clientsResponse));
    } catch (nextError) {
      setError(nextError?.message || 'Unable to load client management data.');
    } finally {
      setIsLoading(false);
    }
  }, [accessToken, debouncedQuery]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setDebouncedQuery(query);
    }, 250);
    return () => clearTimeout(timeoutId);
  }, [query]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const openClient = (client) => {
    setSelectedClient(client);
    setRenameValue(String(client?.client_name || ''));
    setClientMutationState({ isSaving: false, isRemoving: false, error: null });
  };

  const handleRename = async () => {
    if (!selectedClient || !accessToken || clientMutationState.isSaving) {
      return;
    }
    const normalizedName = renameValue.trim();
    if (!normalizedName) {
      setClientMutationState((current) => ({
        ...current,
        error: 'Client name cannot be empty.',
      }));
      return;
    }
    setClientMutationState({ isSaving: true, isRemoving: false, error: null });
    try {
      const payload = await updateTrainerClient({
        accessToken,
        clientId: selectedClient.client_id || selectedClient.id,
        clientName: normalizedName,
      });
      setClientsPayload((current) => ({
        ...current,
        items: current.items.map((client) => (
          (client.client_id || client.id) === (payload.client_id || payload.id)
            ? { ...client, ...payload }
            : client
        )),
      }));
      setSelectedClient(null);
      onClientsMutated?.();
    } catch (error) {
      setClientMutationState({
        isSaving: false,
        isRemoving: false,
        error: error?.message || 'Unable to update client.',
      });
    }
  };

  const handleRemove = async () => {
    if (!selectedClient || !accessToken || clientMutationState.isRemoving) {
      return;
    }
    setClientMutationState({ isSaving: false, isRemoving: true, error: null });
    try {
      const payload = await removeTrainerClient({
        accessToken,
        clientId: selectedClient.client_id || selectedClient.id,
      });
      const removedClientId = payload.client_id || payload.id || selectedClient.client_id || selectedClient.id;
      setClientsPayload((current) => ({
        count: Math.max(0, current.count - 1),
        items: current.items.filter((client) => (client.client_id || client.id) !== removedClientId),
      }));
      setSelectedClient(null);
      onClientsMutated?.();
    } catch (error) {
      setClientMutationState({
        isSaving: false,
        isRemoving: false,
        error: error?.message || 'Unable to remove client.',
      });
    }
  };

  return (
    <SectionShell
      title="Client Management"
      subtitle="Rename and unassign clients from your current roster."
      onBack={onBack}
      bottomInset={bottomInset}
    >
      <ModeCard variant="hero">
        <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>Client Invites</ModeText>
        <ModeText variant="bodySm" tone="secondary">
          Create invite codes from the Clients tab. Codes expire in 12 hours and are single-use.
        </ModeText>
      </ModeCard>

      <SystemSearchBar
        value={query}
        onChangeText={setQuery}
        placeholder="Search clients"
        testID="trainer-system-client-management-search"
      />

      <SystemSectionCard>
        <SystemSectionHeader title="Assigned Clients" />
        {isLoading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={theme.colors.brand.progressCore} />
            <ModeText variant="bodySm" tone="secondary">Loading clients...</ModeText>
          </View>
        ) : null}
        {!isLoading && error ? (
          <ModeText variant="bodySm" tone="error">{error}</ModeText>
        ) : null}
        {!isLoading && !error && clientsPayload.items.length === 0 ? (
          <EmptyListState
            title="No assigned clients"
            detail="Use the Clients tab to create an invite code and share it with your client."
          />
        ) : null}
        {!isLoading && !error && clientsPayload.items.length > 0 ? clientsPayload.items.map((client) => (
          <SystemNavRow
            key={client.client_id || client.id}
            icon="user"
            title={client.is_pending_user ? 'Pending user' : (client.client_name || 'Unnamed client')}
            subtitle={client.user_id || client.client_id || 'Client'}
            onPress={() => openClient(client)}
            testID={`trainer-system-client-management-row-${client.client_id || client.id}`}
          />
        )) : null}
      </SystemSectionCard>

      <SystemActionSheet
        visible={Boolean(selectedClient)}
        onClose={() => setSelectedClient(null)}
        testID="trainer-system-client-management-sheet"
      >
        {selectedClient ? (
          <View style={styles.sheetContent}>
            <ModeText variant="label" tone="tertiary">Manage Client</ModeText>
            <ModeInput
              value={renameValue}
              onChangeText={setRenameValue}
              placeholder="Client name"
              testID="trainer-system-client-management-rename-input"
            />
            {clientMutationState.error ? (
              <ModeText variant="caption" tone="error">{clientMutationState.error}</ModeText>
            ) : null}
            <View style={styles.buttonStack}>
              <ModeButton
                title={clientMutationState.isSaving ? 'Saving...' : 'Save name'}
                onPress={handleRename}
                disabled={clientMutationState.isSaving}
                testID="trainer-system-client-management-save-name"
              />
              <ModeButton
                title="Open detail"
                variant="ghost"
                onPress={() => {
                  const clientId = selectedClient.client_id || selectedClient.id;
                  setSelectedClient(null);
                  onOpenClientDetail(clientId);
                }}
                testID="trainer-system-client-management-open-detail"
              />
              <ModeButton
                title={clientMutationState.isRemoving ? 'Removing...' : 'Remove client'}
                variant="destructive"
                onPress={handleRemove}
                disabled={clientMutationState.isRemoving}
                testID="trainer-system-client-management-remove"
              />
            </View>
          </View>
        ) : null}
      </SystemActionSheet>
    </SectionShell>
  );
}

function MemoryComposer({
  value,
  onChangeText,
  onSubmit,
  canSubmit,
  isSaving,
  visibility,
  onSelectVisibility,
  tagsCount,
  onOpenTags,
}) {
  return (
    <View style={styles.systemMemoryComposer}>
      <View style={styles.systemMemoryComposerMainRow}>
        <ModeInput
          testID="trainer-system-client-memory-composer-input"
          value={value}
          onChangeText={onChangeText}
          placeholder="Add memory..."
          onSubmitEditing={onSubmit}
          returnKeyType="done"
          blurOnSubmit
          style={styles.systemMemoryComposerInput}
        />
        <Pressable
          testID="trainer-system-client-memory-composer-submit"
          onPress={onSubmit}
          disabled={!canSubmit}
          style={({ pressed }) => [
            styles.systemMemoryComposerSubmitButton,
            !canSubmit && styles.systemMemoryComposerSubmitButtonDisabled,
            pressed && canSubmit && styles.systemMemoryComposerSubmitButtonPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={isSaving ? 'Saving memory' : 'Save memory'}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color={theme.colors.text.primary} />
          ) : (
            <Feather name="plus" size={16} color={theme.colors.text.primary} />
          )}
        </Pressable>
      </View>

      <View style={styles.systemMemoryComposerSecondaryRow}>
        <View style={styles.systemMemoryVisibilitySegmented}>
          <Pressable
            testID="trainer-system-client-memory-composer-ai-toggle"
            onPress={() => onSelectVisibility(MEMORY_VISIBILITY.AI)}
            disabled={isSaving}
            style={({ pressed }) => [
              styles.systemMemorySegmentButton,
              visibility === MEMORY_VISIBILITY.AI && styles.systemMemorySegmentButtonActive,
              pressed && styles.systemMemorySegmentButtonPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Set memory visibility to AI"
          >
            <ModeText
              variant="caption"
              tone={visibility === MEMORY_VISIBILITY.AI ? 'primary' : 'secondary'}
              style={styles.systemMemorySegmentLabel}
            >
              AI
            </ModeText>
          </Pressable>
          <Pressable
            testID="trainer-system-client-memory-composer-internal-toggle"
            onPress={() => onSelectVisibility(MEMORY_VISIBILITY.INTERNAL)}
            disabled={isSaving}
            style={({ pressed }) => [
              styles.systemMemorySegmentButton,
              visibility === MEMORY_VISIBILITY.INTERNAL && styles.systemMemorySegmentButtonActive,
              pressed && styles.systemMemorySegmentButtonPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Set memory visibility to Internal"
          >
            <ModeText
              variant="caption"
              tone={visibility === MEMORY_VISIBILITY.INTERNAL ? 'primary' : 'secondary'}
              style={styles.systemMemorySegmentLabel}
            >
              Internal
            </ModeText>
          </Pressable>
        </View>

        <Pressable
          testID="trainer-system-client-memory-composer-add-tags"
          onPress={onOpenTags}
          disabled={isSaving}
          style={({ pressed }) => [
            styles.systemMemoryTagsAction,
            pressed && styles.systemMemoryTagsActionPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Add memory tags"
        >
          <ModeText variant="caption" tone="secondary" style={styles.systemMemoryTagsActionText}>
            {tagsCount > 0 ? `+ Tags (${tagsCount})` : '+ Tags'}
          </ModeText>
        </Pressable>
      </View>
    </View>
  );
}

function MemoryFilterBar({ value, onChange }) {
  return (
    <View style={styles.systemMemoryFilterBar}>
      {MEMORY_FILTER_SEGMENTS.map((segment) => (
        <ModeChip
          key={segment.key}
          testID={`trainer-system-client-memory-filter-${segment.key}`}
          label={segment.label}
          selected={value === segment.key}
          onPress={() => onChange(segment.key)}
          style={styles.systemMemoryFilterChip}
        />
      ))}
    </View>
  );
}

function SwipeableMemoryRow({
  record,
  isSaving,
  onOpen,
  onEdit,
  onArchive,
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const [revealedSide, setRevealedSide] = useState(null);

  const animateTo = useCallback((nextValue) => {
    Animated.spring(translateX, {
      toValue: nextValue,
      useNativeDriver: true,
      bounciness: 0,
      speed: 18,
    }).start();
  }, [translateX]);

  const closeActions = useCallback(() => {
    setRevealedSide(null);
    animateTo(0);
  }, [animateTo]);

  const revealSide = useCallback((side) => {
    setRevealedSide(side);
    animateTo(side === 'left' ? MEMORY_SWIPE_REVEAL_DISTANCE : -MEMORY_SWIPE_REVEAL_DISTANCE);
  }, [animateTo]);

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gestureState) => (
      Math.abs(gestureState.dx) > 8 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy)
    ),
    onPanResponderMove: (_event, gestureState) => {
      const clamped = Math.max(
        -MEMORY_SWIPE_REVEAL_DISTANCE,
        Math.min(MEMORY_SWIPE_REVEAL_DISTANCE, gestureState.dx),
      );
      translateX.setValue(clamped);
    },
    onPanResponderRelease: (_event, gestureState) => {
      if (gestureState.dx >= MEMORY_SWIPE_OPEN_THRESHOLD) {
        revealSide('left');
        return;
      }
      if (gestureState.dx <= -MEMORY_SWIPE_OPEN_THRESHOLD) {
        revealSide('right');
        return;
      }
      closeActions();
    },
    onPanResponderTerminate: closeActions,
  }), [closeActions, revealSide, translateX]);

  const handleRowPress = () => {
    if (revealedSide) {
      closeActions();
      return;
    }
    onOpen?.();
  };

  const handleEditPress = () => {
    closeActions();
    onEdit?.();
  };

  const handleArchivePress = () => {
    closeActions();
    onArchive?.();
  };

  const metaLine = buildMemoryMetaLine(record);
  const isLeftRevealed = revealedSide === 'left';
  const isRightRevealed = revealedSide === 'right';

  return (
    <View style={styles.systemMemorySwipeRowWrap}>
      <Pressable
        testID={`trainer-system-client-memory-row-swipe-${record.id}`}
        onPress={() => revealSide('left')}
        onLongPress={() => revealSide('right')}
        style={styles.systemMemorySwipeTestHook}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      <View style={styles.systemMemorySwipeActionsLayer} pointerEvents="box-none">
        <View style={styles.systemMemorySwipeActionLeft}>
          {isLeftRevealed ? (
            <Pressable
              testID={`trainer-system-client-memory-edit-${record.id}`}
              onPress={handleEditPress}
              disabled={isSaving}
              style={({ pressed }) => [
                styles.systemMemorySwipeActionButton,
                styles.systemMemorySwipeActionEdit,
                pressed && styles.systemMemorySwipeActionButtonPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Edit memory"
            >
              <ModeText variant="caption" tone="primary" style={styles.systemMemorySwipeActionLabel}>Edit</ModeText>
            </Pressable>
          ) : null}
        </View>
        <View style={styles.systemMemorySwipeActionRight}>
          {isRightRevealed ? (
            <Pressable
              testID={`trainer-system-client-memory-archive-${record.id}`}
              onPress={handleArchivePress}
              disabled={isSaving}
              style={({ pressed }) => [
                styles.systemMemorySwipeActionButton,
                styles.systemMemorySwipeActionArchive,
                pressed && styles.systemMemorySwipeActionButtonPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Archive memory"
            >
              <ModeText variant="caption" tone="error" style={styles.systemMemorySwipeActionLabel}>Archive</ModeText>
            </Pressable>
          ) : null}
        </View>
      </View>

      <Animated.View
        style={[
          styles.systemMemorySwipeTrack,
          { transform: [{ translateX }] },
        ]}
        {...panResponder.panHandlers}
      >
        <Pressable
          testID={`trainer-system-client-memory-row-${record.id}`}
          onPress={handleRowPress}
          style={({ pressed }) => [
            styles.systemMemoryDenseRow,
            pressed && styles.systemMemoryDenseRowPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Open memory editor"
        >
          <View style={styles.systemMemoryDenseRowMain}>
            <ModeText
              variant="bodySm"
              numberOfLines={1}
              style={styles.systemMemoryDenseRowText}
            >
              {record?.text || 'No text captured.'}
            </ModeText>
            <ModeText
              variant="caption"
              tone="secondary"
              numberOfLines={1}
              style={styles.systemMemoryDenseRowMeta}
            >
              {metaLine || 'Date unavailable'}
            </ModeText>
          </View>
        </Pressable>
      </Animated.View>
    </View>
  );
}

function MemoryList({
  memoryFilter,
  records,
  isSaving,
  onOpenMemoryEditor,
  onEditMemory,
  onArchiveMemory,
}) {
  if (records.length === 0) {
    if (memoryFilter === MEMORY_FILTER.AI) {
      return <ModeText variant="bodySm" tone="secondary">No AI memories yet.</ModeText>;
    }
    if (memoryFilter === MEMORY_FILTER.INTERNAL) {
      return <ModeText variant="bodySm" tone="secondary">No internal memories yet.</ModeText>;
    }
    return <ModeText variant="bodySm" tone="secondary">No memories yet. Add your first memory above.</ModeText>;
  }

  return records.map((record) => (
    <SwipeableMemoryRow
      key={record.id}
      record={record}
      isSaving={isSaving}
      onOpen={() => onOpenMemoryEditor(record)}
      onEdit={() => onEditMemory(record)}
      onArchive={() => onArchiveMemory(record.id)}
    />
  ));
}

function ClientDetailManagementScreen({
  accessToken,
  bottomInset,
  onBack,
  clientId,
}) {
  const [detail, setDetail] = useState(null);
  const [memoryRecords, setMemoryRecords] = useState([]);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingMemory, setIsSavingMemory] = useState(false);
  const [memoryMutationError, setMemoryMutationError] = useState(null);
  const [memoryMutationSuccess, setMemoryMutationSuccess] = useState(null);
  const [newMemoryText, setNewMemoryText] = useState('');
  const [newMemoryVisibility, setNewMemoryVisibility] = useState(MEMORY_VISIBILITY.AI);
  const [isComposerTagsSheetVisible, setIsComposerTagsSheetVisible] = useState(false);
  const [newMemoryTagsText, setNewMemoryTagsText] = useState('');
  const [memoryFilter, setMemoryFilter] = useState(MEMORY_FILTER.ALL);
  const [editingMemoryId, setEditingMemoryId] = useState(null);
  const [editingText, setEditingText] = useState('');
  const [editingAiReadable, setEditingAiReadable] = useState(true);
  const [isEditingTagsVisible, setIsEditingTagsVisible] = useState(false);
  const [editingTagsText, setEditingTagsText] = useState('');

  const editingRecord = useMemo(
    () => memoryRecords.find((record) => record?.id === editingMemoryId) || null,
    [memoryRecords, editingMemoryId],
  );

  const sortedMemoryRecords = useMemo(
    () => [...memoryRecords].sort((a, b) => resolveMemoryUpdatedAt(b) - resolveMemoryUpdatedAt(a)),
    [memoryRecords],
  );

  const filteredMemoryRecords = useMemo(() => {
    if (memoryFilter === MEMORY_FILTER.AI) {
      return sortedMemoryRecords.filter((record) => record?.visibility === MEMORY_VISIBILITY.AI);
    }
    if (memoryFilter === MEMORY_FILTER.INTERNAL) {
      return sortedMemoryRecords.filter((record) => record?.visibility !== MEMORY_VISIBILITY.AI);
    }
    return sortedMemoryRecords;
  }, [memoryFilter, sortedMemoryRecords]);

  const canSaveNewMemory = newMemoryText.trim().length > 0 && !isSavingMemory;
  const composerTagCount = useMemo(() => parseTags(newMemoryTagsText).length, [newMemoryTagsText]);

  const closeMemoryEditSheet = useCallback(() => {
    setEditingMemoryId(null);
    setEditingText('');
    setEditingAiReadable(true);
    setIsEditingTagsVisible(false);
    setEditingTagsText('');
  }, []);

  const loadMemoryRecords = useCallback(async () => {
    if (!accessToken || !clientId) {
      setMemoryRecords([]);
      return;
    }
    const memoryPayload = await listTrainerClientMemory({ accessToken, clientId });
    setMemoryRecords(Array.isArray(memoryPayload) ? memoryPayload : []);
  }, [accessToken, clientId]);

  const loadClient = useCallback(async () => {
    if (!accessToken || !clientId) {
      setDetail(null);
      setMemoryRecords([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const [detailPayload] = await Promise.all([
        getTrainerClientDetail({ accessToken, clientId }),
        loadMemoryRecords(),
      ]);
      setDetail(detailPayload);
    } catch (nextError) {
      setError(nextError?.message || 'Unable to load client detail.');
    } finally {
      setIsLoading(false);
    }
  }, [accessToken, clientId, loadMemoryRecords]);

  useEffect(() => {
    loadClient();
  }, [loadClient]);

  const openMemoryEditor = (record) => {
    setEditingMemoryId(record.id);
    setEditingText(record.text || '');
    setEditingAiReadable(record.visibility === MEMORY_VISIBILITY.AI);
    const tagValues = Array.isArray(record.tags) ? record.tags : [];
    setEditingTagsText(tagValues.join(', '));
    setIsEditingTagsVisible(tagValues.length > 0);
    setMemoryMutationError(null);
    setMemoryMutationSuccess(null);
  };

  const handleCreateMemory = async () => {
    if (!accessToken || !clientId || isSavingMemory) {
      return;
    }
    const trimmedText = newMemoryText.trim();
    if (!trimmedText) {
      setMemoryMutationError('Add memory text before saving.');
      setMemoryMutationSuccess(null);
      return;
    }
    const submittedTagsText = newMemoryTagsText;
    const submittedTags = parseTags(submittedTagsText);
    const submittedVisibility = newMemoryVisibility;

    setIsSavingMemory(true);
    setMemoryMutationError(null);
    setMemoryMutationSuccess(null);
    setNewMemoryText('');
    try {
      await createTrainerClientMemory({
        accessToken,
        clientId,
        memoryType: 'note',
        text: trimmedText,
        visibility: submittedVisibility,
        tags: submittedTags,
      });
      await loadMemoryRecords();
      setNewMemoryTagsText('');
      setIsComposerTagsSheetVisible(false);
      setMemoryMutationSuccess('Memory saved.');
      Vibration.vibrate(10);
    } catch (nextError) {
      setNewMemoryText(trimmedText);
      setNewMemoryTagsText(submittedTagsText);
      setIsComposerTagsSheetVisible(submittedTagsText.trim().length > 0);
      setMemoryMutationError(nextError?.message || 'Unable to save memory.');
    } finally {
      setIsSavingMemory(false);
    }
  };

  const handleMemoryComposerSubmit = () => {
    if (!canSaveNewMemory) {
      return;
    }
    handleCreateMemory();
  };

  const handleSaveMemoryEdit = async () => {
    if (!accessToken || !clientId || !editingMemoryId || isSavingMemory) {
      return;
    }
    const trimmedText = editingText.trim();
    if (!trimmedText) {
      setMemoryMutationError('Memory text cannot be empty.');
      setMemoryMutationSuccess(null);
      return;
    }

    setIsSavingMemory(true);
    setMemoryMutationError(null);
    setMemoryMutationSuccess(null);
    try {
      await updateTrainerClientMemory({
        accessToken,
        clientId,
        memoryId: editingMemoryId,
        text: trimmedText,
        visibility: editingAiReadable ? MEMORY_VISIBILITY.AI : MEMORY_VISIBILITY.INTERNAL,
        tags: parseTags(editingTagsText),
      });
      await loadMemoryRecords();
      closeMemoryEditSheet();
      setMemoryMutationSuccess('Memory updated.');
    } catch (nextError) {
      setMemoryMutationError(nextError?.message || 'Unable to update memory.');
    } finally {
      setIsSavingMemory(false);
    }
  };

  const handleArchiveMemory = async (memoryId) => {
    if (!accessToken || !clientId || !memoryId || isSavingMemory) {
      return;
    }
    setIsSavingMemory(true);
    setMemoryMutationError(null);
    setMemoryMutationSuccess(null);
    try {
      await archiveTrainerClientMemory({
        accessToken,
        clientId,
        memoryId,
      });
      await loadMemoryRecords();
      if (editingMemoryId === memoryId) {
        closeMemoryEditSheet();
      }
      setMemoryMutationSuccess('Memory archived.');
    } catch (nextError) {
      setMemoryMutationError(nextError?.message || 'Unable to archive memory.');
    } finally {
      setIsSavingMemory(false);
    }
  };

  const handleArchiveMemoryRequest = (memoryId) => {
    if (!memoryId || isSavingMemory) {
      return;
    }
    Alert.alert(
      'Archive memory?',
      'This removes it from active memory.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Archive',
          style: 'destructive',
          onPress: () => {
            handleArchiveMemory(memoryId);
          },
        },
      ],
      { cancelable: true },
    );
  };

  const clientName = detail?.client?.client_name || 'Client';

  return (
    <SectionShell
      title={clientName}
      subtitle="Client detail management"
      onBack={onBack}
      bottomInset={bottomInset}
    >
      {isLoading ? (
        <ModeCard variant="surface">
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={theme.colors.brand.progressCore} />
            <ModeText variant="bodySm" tone="secondary">Loading client detail...</ModeText>
          </View>
        </ModeCard>
      ) : null}
      {!isLoading && error ? (
        <ModeCard variant="surface">
          <ModeText variant="bodySm" tone="error">{error}</ModeText>
        </ModeCard>
      ) : null}
      {!isLoading && !error && detail ? (
        <>
          <ModeCard variant="surface" style={styles.systemMemoryCard}>
            <View style={styles.systemMemoryHeaderRow}>
              <ModeText variant="label" tone="tertiary" style={styles.systemMemorySectionLabel}>Client Memory</ModeText>
            </View>

            <MemoryComposer
              value={newMemoryText}
              onChangeText={setNewMemoryText}
              onSubmit={handleMemoryComposerSubmit}
              canSubmit={canSaveNewMemory}
              isSaving={isSavingMemory}
              visibility={newMemoryVisibility}
              onSelectVisibility={setNewMemoryVisibility}
              tagsCount={composerTagCount}
              onOpenTags={() => setIsComposerTagsSheetVisible(true)}
            />

            {memoryMutationError ? (
              <ModeText variant="caption" tone="error" style={styles.systemMemoryInlineFeedback}>{memoryMutationError}</ModeText>
            ) : null}
            {memoryMutationSuccess ? (
              <ModeText variant="caption" tone="secondary" style={styles.systemMemoryInlineFeedback}>{memoryMutationSuccess}</ModeText>
            ) : null}

            <MemoryFilterBar
              value={memoryFilter}
              onChange={setMemoryFilter}
            />

            <View style={styles.systemMemoryDenseList}>
              <MemoryList
                memoryFilter={memoryFilter}
                records={filteredMemoryRecords}
                isSaving={isSavingMemory}
                onOpenMemoryEditor={openMemoryEditor}
                onEditMemory={openMemoryEditor}
                onArchiveMemory={handleArchiveMemoryRequest}
              />
            </View>
          </ModeCard>

          <ModeCard variant="hero">
            <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>Client Snapshot</ModeText>
            <DetailRow label="Primary goal" value={valueOrFallback(detail?.profile_snapshot?.primary_goal)} />
            <DetailRow label="Onboarding" value={valueOrFallback(detail?.profile_snapshot?.onboarding_status)} />
            <DetailRow label="Experience" value={valueOrFallback(detail?.profile_snapshot?.experience_level)} />
            <DetailRow label="Current mode" value={valueOrFallback(detail?.profile_snapshot?.current_mode)} />
          </ModeCard>

          <SystemSectionCard>
            <SystemSectionHeader title="Activity" />
            <DetailRow label="Latest check-in" value={valueOrFallback(detail?.activity_summary?.latest_checkin_date, 'No recent check-in')} />
            <DetailRow label="Sessions this week" value={valueOrFallback(detail?.activity_summary?.workouts_completed_7d, '0')} />
            <DetailRow label="Check-ins this week" value={valueOrFallback(detail?.activity_summary?.checkins_completed_7d, '0')} />
            <DetailRow label="Meeting location" value={valueOrFallback(detail?.activity_summary?.meeting_location)} />
            <DetailRow label="Next session" value={formatDateTime(detail?.activity_summary?.session_start_at)} />
          </SystemSectionCard>

          <SystemSectionCard>
            <SystemSectionHeader title="Schedule" />
            <DetailRow label="Recurring days" value={formatIsoWeekdaySummary(detail?.schedule_preferences?.recurring_weekdays)} />
            <DetailRow
              label="Preferred location"
              value={valueOrFallback(detail?.schedule_preferences?.preferred_meeting_location)}
            />
            <DetailRow
              label="Uses trainer default"
              value={detail?.schedule_preferences?.auto_use_trainer_default_location === false ? 'No' : 'Yes'}
            />
            {Array.isArray(detail?.schedule_preferences?.upcoming_exceptions)
              && detail.schedule_preferences.upcoming_exceptions.length > 0
              ? detail.schedule_preferences.upcoming_exceptions.map((exception) => (
                <ModeText
                  key={`${exception.session_date}-${exception.exception_type}`}
                  variant="caption"
                  tone="secondary"
                >
                  {`${formatExceptionDate(exception.session_date)} · ${exception.exception_type}`}
                  {exception.meeting_location_override ? ` @ ${exception.meeting_location_override}` : ''}
                </ModeText>
              ))
              : (
                <ModeText variant="caption" tone="secondary">No upcoming exceptions.</ModeText>
              )}
          </SystemSectionCard>

        </>
      ) : null}
      <SystemActionSheet
        visible={isComposerTagsSheetVisible}
        onClose={() => setIsComposerTagsSheetVisible(false)}
        testID="trainer-system-client-memory-composer-tags-sheet"
      >
        <View style={styles.sheetContent}>
          <ModeText variant="label" tone="tertiary">Memory Tags</ModeText>
          <ModeInput
            testID="trainer-system-client-memory-composer-tags-input"
            value={newMemoryTagsText}
            onChangeText={setNewMemoryTagsText}
            placeholder="Tags (comma separated)"
            style={styles.systemMemoryTagsInput}
          />
          <View style={styles.buttonStack}>
            <ModeButton
              title="Clear tags"
              variant="ghost"
              size="sm"
              disabled={isSavingMemory || newMemoryTagsText.trim().length === 0}
              onPress={() => setNewMemoryTagsText('')}
              testID="trainer-system-client-memory-composer-tags-clear"
            />
            <ModeButton
              title="Done"
              variant="primary"
              size="sm"
              disabled={isSavingMemory}
              onPress={() => setIsComposerTagsSheetVisible(false)}
              testID="trainer-system-client-memory-composer-tags-done"
            />
          </View>
        </View>
      </SystemActionSheet>
      <SystemActionSheet
        visible={Boolean(editingRecord)}
        onClose={closeMemoryEditSheet}
        testID="trainer-system-client-memory-edit-sheet"
      >
        {editingRecord ? (
          <View style={styles.sheetContent}>
            <View style={styles.systemMemoryEditHeader}>
              <View style={styles.systemMemoryEditHeaderCopy}>
                <ModeText variant="label" tone="tertiary" style={styles.systemMemorySectionLabel}>Edit Memory</ModeText>
                <ModeText variant="caption" tone="secondary">{toTitleCase(editingRecord.memory_type || 'note')}</ModeText>
              </View>
              <Pressable
                testID="trainer-system-client-memory-edit-close"
                style={({ pressed }) => [
                  styles.systemMemoryIconButton,
                  pressed && styles.systemMemoryIconButtonPressed,
                ]}
                onPress={closeMemoryEditSheet}
                accessibilityRole="button"
                accessibilityLabel="Close memory editor"
                hitSlop={6}
              >
                <Feather name="x" size={16} color={theme.colors.text.secondary} />
              </Pressable>
            </View>
            <ModeInput
              testID="trainer-system-client-memory-edit-input"
              value={editingText}
              onChangeText={setEditingText}
              placeholder="Update memory note..."
              style={styles.systemMemoryComposerInput}
            />
            <View style={styles.systemMemoryComposerMetaRow}>
              <View style={styles.systemMemoryVisibilitySegment}>
                <ModeChip
                  testID="trainer-system-client-memory-edit-ai-toggle"
                  label="AI"
                  selected={editingAiReadable}
                  onPress={() => setEditingAiReadable(true)}
                  disabled={isSavingMemory}
                />
                <ModeChip
                  testID="trainer-system-client-memory-edit-internal-toggle"
                  label="Internal"
                  selected={!editingAiReadable}
                  onPress={() => setEditingAiReadable(false)}
                  disabled={isSavingMemory}
                />
              </View>
              {!isEditingTagsVisible ? (
                <ModeChip
                  testID="trainer-system-client-memory-edit-add-tags"
                  label="+ Tags"
                  onPress={() => setIsEditingTagsVisible(true)}
                  disabled={isSavingMemory}
                />
              ) : null}
            </View>
            {isEditingTagsVisible ? (
              <ModeInput
                testID="trainer-system-client-memory-edit-tags-input"
                value={editingTagsText}
                onChangeText={setEditingTagsText}
                placeholder="Tags (comma separated)"
                style={styles.systemMemoryTagsInput}
              />
            ) : null}
            <View style={styles.buttonStack}>
              <ModeButton
                testID="trainer-system-client-memory-edit-cancel"
                title="Cancel"
                variant="ghost"
                size="sm"
                disabled={isSavingMemory}
                onPress={closeMemoryEditSheet}
              />
              <ModeButton
                testID="trainer-system-client-memory-edit-save"
                title={isSavingMemory ? 'Saving...' : 'Save'}
                variant="primary"
                size="sm"
                disabled={isSavingMemory}
                onPress={handleSaveMemoryEdit}
              />
            </View>
          </View>
        ) : null}
      </SystemActionSheet>
    </SectionShell>
  );
}

function ReviewHubScreen({
  accessToken,
  bottomInset,
  onBack,
  onReviewMutated,
}) {
  const [segment, setSegment] = useState(REVIEW_SEGMENT.DRAFTS);
  const [draftPayload, setDraftPayload] = useState({ items: [], count: 0 });
  const [outputsPayload, setOutputsPayload] = useState({ items: [], count: 0 });
  const [qaItems, setQaItems] = useState([]);
  const [aiLearningItems, setAiLearningItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);
  const [editedText, setEditedText] = useState('');
  const [mutationState, setMutationState] = useState({ isSaving: false, error: null, success: null });

  const loadReviewData = useCallback(async () => {
    if (!accessToken) {
      setDraftPayload({ items: [], count: 0 });
      setOutputsPayload({ items: [], count: 0 });
      setQaItems([]);
      setAiLearningItems([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const [draftResponse, outputResponse, qaResponse, aiLearningResponse] = await Promise.all([
        getTrainerCoachQueue({ accessToken, limit: 50 }),
        getTrainerReviewOutputs({ accessToken, status: 'open', limit: 50, offset: 0 }),
        requestTrainerReviewQueue({ accessToken }),
        getTrainerAiReviewQueue({ accessToken, status: 'pending', limit: 50 }).catch(() => []),
      ]);
      setDraftPayload(normalizeListPayload(draftResponse));
      setOutputsPayload(normalizeListPayload(outputResponse));
      setQaItems(Array.isArray(qaResponse) ? qaResponse : []);
      setAiLearningItems(Array.isArray(aiLearningResponse) ? aiLearningResponse : []);
    } catch (nextError) {
      setError(nextError?.message || 'Unable to load review hub.');
    } finally {
      setIsLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    loadReviewData();
  }, [loadReviewData]);

  const currentItems = useMemo(() => {
    if (segment === REVIEW_SEGMENT.DRAFTS) {
      return draftPayload.items;
    }
    if (segment === REVIEW_SEGMENT.OUTPUTS) {
      return outputsPayload.items;
    }
    if (segment === REVIEW_SEGMENT.AI_LEARNING) {
      return aiLearningItems;
    }
    return qaItems;
  }, [aiLearningItems, draftPayload.items, outputsPayload.items, qaItems, segment]);

  const openItem = (item) => {
    setSelectedItem(item);
    setEditedText(
      String(
        item?.reviewed_output_text
        || item?.edited_output_text
        || item?.output_text
        || item?.model_draft_answer
        || item?.proposed_rule
        || '',
      ),
    );
    setMutationState({ isSaving: false, error: null, success: null });
  };

  const handleDraftMutation = async (action) => {
    if (!selectedItem?.output_id || !accessToken || mutationState.isSaving) {
      return;
    }
    setMutationState({ isSaving: true, error: null, success: null });
    try {
      if (action === 'edit') {
        await editTrainerCoachQueueItem({
          accessToken,
          outputId: selectedItem.output_id,
          editedOutputText: editedText,
          editedOutputJson: null,
          notes: null,
        });
      } else if (action === 'approve') {
        await approveTrainerCoachQueueItem({
          accessToken,
          outputId: selectedItem.output_id,
          editedOutputText: editedText,
          editedOutputJson: null,
          applyBundle: {},
          idempotencyKey: `system-review-${selectedItem.output_id}-${Date.now()}`,
        });
      } else {
        await rejectTrainerCoachQueueItem({
          accessToken,
          outputId: selectedItem.output_id,
          reason: 'Rejected from Trainer System Hub',
          editedOutputText: editedText,
          editedOutputJson: null,
        });
      }
      await loadReviewData();
      setSelectedItem(null);
      onReviewMutated?.();
    } catch (nextError) {
      setMutationState({
        isSaving: false,
        error: nextError?.message || 'Unable to update draft queue item.',
        success: null,
      });
    }
  };

  const handleOutputMutation = async (action) => {
    if (!selectedItem?.id || !accessToken || mutationState.isSaving) {
      return;
    }
    setMutationState({ isSaving: true, error: null, success: null });
    try {
      if (action === 'edit') {
        await editTrainerReviewOutput({
          accessToken,
          outputId: selectedItem.id,
          editedOutputText: editedText,
          editedOutputJson: null,
          notes: null,
          autoApplyDeltas: false,
        });
      } else if (action === 'approve') {
        await approveTrainerReviewOutput({
          accessToken,
          outputId: selectedItem.id,
          editedOutputText: editedText,
          editedOutputJson: null,
          responseTags: [],
          autoApplyDeltas: false,
        });
      } else {
        await rejectTrainerReviewOutput({
          accessToken,
          outputId: selectedItem.id,
          reason: 'Rejected from Trainer System Hub',
          editedOutputText: editedText,
          editedOutputJson: null,
        });
      }
      await loadReviewData();
      setSelectedItem(null);
      onReviewMutated?.();
    } catch (nextError) {
      setMutationState({
        isSaving: false,
        error: nextError?.message || 'Unable to update review output.',
        success: null,
      });
    }
  };

  const handleQaApprove = async () => {
    if (!selectedItem?.id || !accessToken || mutationState.isSaving) {
      return;
    }
    const approvedAnswer = editedText.trim();
    if (!approvedAnswer) {
      setMutationState({ isSaving: false, error: 'Approved answer cannot be empty.', success: null });
      return;
    }
    setMutationState({ isSaving: true, error: null, success: null });
    try {
      await approveTrainerReviewQueueItem({
        accessToken,
        queueId: selectedItem.id,
        approvedAnswer,
        responseTags: ['system_hub_approved'],
      });
      await loadReviewData();
      setSelectedItem(null);
      onReviewMutated?.();
    } catch (nextError) {
      setMutationState({
        isSaving: false,
        error: nextError?.message || 'Unable to approve QA queue item.',
        success: null,
      });
    }
  };

  const handleAiLearningMutation = async (action) => {
    if (!selectedItem?.id || !accessToken || mutationState.isSaving) {
      return;
    }
    setMutationState({ isSaving: true, error: null, success: null });
    try {
      if (action === 'edit') {
        await updateTrainerAiReviewQueueItem({
          accessToken,
          queueId: selectedItem.id,
          proposedRule: editedText,
          reviewerNotes: null,
        });
      } else if (action === 'approve') {
        const trimmedRule = editedText.trim();
        if (trimmedRule && trimmedRule !== selectedItem.proposed_rule) {
          await updateTrainerAiReviewQueueItem({
            accessToken,
            queueId: selectedItem.id,
            proposedRule: trimmedRule,
            reviewerNotes: null,
          });
        }
        await approveTrainerAiReviewQueueItem({
          accessToken,
          queueId: selectedItem.id,
        });
      } else if (action === 'delete') {
        await deleteTrainerAiReviewQueueItem({
          accessToken,
          queueId: selectedItem.id,
        });
      } else {
        await rejectTrainerAiReviewQueueItem({
          accessToken,
          queueId: selectedItem.id,
          reviewerNotes: 'Rejected from Trainer System Hub',
        });
      }
      await loadReviewData();
      setSelectedItem(null);
      onReviewMutated?.();
    } catch (nextError) {
      setMutationState({
        isSaving: false,
        error: nextError?.message || 'Unable to update AI learning item.',
        success: null,
      });
    }
  };

  return (
    <SectionShell
      title="Review Hub"
      subtitle="Draft queue, corrections, and low-confidence QA in one compact review surface."
      onBack={onBack}
      bottomInset={bottomInset}
      rightSlot={(
        <ModeButton
          title={isLoading ? 'Loading...' : 'Refresh'}
          variant="ghost"
          size="sm"
          onPress={loadReviewData}
          disabled={isLoading}
          testID="trainer-system-review-refresh"
        />
      )}
    >
      <SegmentedControl
        value={segment}
        onChange={setSegment}
        segments={[
          { key: REVIEW_SEGMENT.DRAFTS, label: `Draft Queue (${draftPayload.count})` },
          { key: REVIEW_SEGMENT.OUTPUTS, label: `Outputs (${outputsPayload.count})` },
          { key: REVIEW_SEGMENT.QA, label: `QA (${qaItems.length})` },
          { key: REVIEW_SEGMENT.AI_LEARNING, label: `AI Learning (${aiLearningItems.length})` },
        ]}
      />

      <SystemSectionCard>
        <SystemSectionHeader
          title={segment === REVIEW_SEGMENT.DRAFTS
            ? 'Draft Queue'
            : segment === REVIEW_SEGMENT.OUTPUTS
              ? 'Outputs / Corrections'
              : segment === REVIEW_SEGMENT.AI_LEARNING
                ? 'AI Learning'
                : 'Low-Confidence QA'}
        />
        {segment === REVIEW_SEGMENT.AI_LEARNING ? (
          <ModeText variant="bodySm" tone="secondary">
            Atlas noticed a pattern in how you coach. Approve this to help your AI sound more like you.
          </ModeText>
        ) : null}
        {isLoading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={theme.colors.brand.progressCore} />
            <ModeText variant="bodySm" tone="secondary">Loading review items...</ModeText>
          </View>
        ) : null}
        {!isLoading && error ? (
          <ModeText variant="bodySm" tone="error">{error}</ModeText>
        ) : null}
        {!isLoading && !error && currentItems.length === 0 ? (
          <EmptyListState
            title="Nothing waiting right now"
            detail="Pending drafts, corrections, and QA items will appear here."
          />
        ) : null}
        {!isLoading && !error && currentItems.length > 0 ? currentItems.map((item, index) => {
          const key = item?.output_id || item?.id || `review-item-${index}`;
          const title = segment === REVIEW_SEGMENT.DRAFTS
            ? item?.headline || item?.client_name || 'Draft review item'
            : segment === REVIEW_SEGMENT.OUTPUTS
              ? item?.output_text || item?.source_type || 'Review output'
              : segment === REVIEW_SEGMENT.AI_LEARNING
                ? item?.proposed_rule || 'Suggested AI learning'
                : item?.user_question || 'Low-confidence output';
          const subtitle = segment === REVIEW_SEGMENT.DRAFTS
            ? `${item?.client_name || 'Client'} · ${item?.summary || item?.action_type || 'Open draft'}`
            : segment === REVIEW_SEGMENT.OUTPUTS
              ? `${item?.source_type || 'chat'}${item?.client_id ? ` · ${item.client_id}` : ''}`
              : segment === REVIEW_SEGMENT.AI_LEARNING
                ? item?.reason_detected || 'Trainer-specific AI rule pending approval'
                : `Confidence ${typeof item?.confidence_score === 'number' ? `${(item.confidence_score * 100).toFixed(0)}%` : 'unknown'} · ${item?.status || 'open'}`;
          const badge = segment === REVIEW_SEGMENT.DRAFTS
            ? item?.priority_tier || null
            : segment === REVIEW_SEGMENT.OUTPUTS
              ? item?.review_status || null
              : segment === REVIEW_SEGMENT.AI_LEARNING
                ? item?.reviewer_status || null
              : typeof item?.confidence_score === 'number'
                ? `${Math.round(item.confidence_score * 100)}%`
                : null;
          return (
            <SystemNavRow
              key={key}
              icon={segment === REVIEW_SEGMENT.QA ? 'alert-circle' : segment === REVIEW_SEGMENT.AI_LEARNING ? 'cpu' : 'check-square'}
              title={title}
              subtitle={subtitle}
              badge={badge}
              badgeVariant={segment === REVIEW_SEGMENT.QA ? 'warning' : 'default'}
              onPress={() => openItem(item)}
              testID={`trainer-system-review-row-${key}`}
            />
          );
        }) : null}
      </SystemSectionCard>

      <SystemActionSheet
        visible={Boolean(selectedItem)}
        onClose={() => setSelectedItem(null)}
        testID="trainer-system-review-sheet"
      >
        {selectedItem ? (
          <View style={styles.sheetContent}>
            <ModeText variant="label" tone="tertiary">Review Item</ModeText>
            {segment === REVIEW_SEGMENT.QA ? (
              <>
                <ModeText variant="bodySm">{selectedItem.user_question}</ModeText>
                <ModeText variant="caption" tone="secondary">
                  Confidence {typeof selectedItem.confidence_score === 'number'
                    ? `${(selectedItem.confidence_score * 100).toFixed(0)}%`
                    : 'unknown'}
                </ModeText>
              </>
            ) : null}
            {segment === REVIEW_SEGMENT.AI_LEARNING ? (
              <ModeText variant="bodySm" tone="secondary">
                Atlas noticed a pattern in how you coach. Approve this to help your AI sound more like you.
              </ModeText>
            ) : null}
            <ModeInput
              value={editedText}
              onChangeText={setEditedText}
              placeholder={segment === REVIEW_SEGMENT.AI_LEARNING ? 'Review and edit the learned rule' : 'Review and edit the response text'}
              multiline
              style={styles.multilineInput}
              testID="trainer-system-review-edit-input"
            />
            {mutationState.error ? (
              <ModeText variant="caption" tone="error">{mutationState.error}</ModeText>
            ) : null}
            <View style={styles.buttonStack}>
              {segment === REVIEW_SEGMENT.DRAFTS ? (
                <>
                  <ModeButton
                    title={mutationState.isSaving ? 'Saving...' : 'Save draft edit'}
                    onPress={() => handleDraftMutation('edit')}
                    disabled={mutationState.isSaving}
                    testID="trainer-system-review-draft-save"
                  />
                  <ModeButton
                    title="Approve draft"
                    variant="secondary"
                    onPress={() => handleDraftMutation('approve')}
                    disabled={mutationState.isSaving}
                    testID="trainer-system-review-draft-approve"
                  />
                  <ModeButton
                    title="Reject draft"
                    variant="destructive"
                    onPress={() => handleDraftMutation('reject')}
                    disabled={mutationState.isSaving}
                    testID="trainer-system-review-draft-reject"
                  />
                </>
              ) : null}
              {segment === REVIEW_SEGMENT.OUTPUTS ? (
                <>
                  <ModeButton
                    title={mutationState.isSaving ? 'Saving...' : 'Save correction'}
                    onPress={() => handleOutputMutation('edit')}
                    disabled={mutationState.isSaving}
                    testID="trainer-system-review-output-save"
                  />
                  <ModeButton
                    title="Approve output"
                    variant="secondary"
                    onPress={() => handleOutputMutation('approve')}
                    disabled={mutationState.isSaving}
                    testID="trainer-system-review-output-approve"
                  />
                  <ModeButton
                    title="Reject output"
                    variant="destructive"
                    onPress={() => handleOutputMutation('reject')}
                    disabled={mutationState.isSaving}
                    testID="trainer-system-review-output-reject"
                  />
                </>
              ) : null}
              {segment === REVIEW_SEGMENT.QA ? (
                <ModeButton
                  title={mutationState.isSaving ? 'Approving...' : 'Approve QA item'}
                  onPress={handleQaApprove}
                  disabled={mutationState.isSaving}
                  testID="trainer-system-review-qa-approve"
                />
              ) : null}
              {segment === REVIEW_SEGMENT.AI_LEARNING ? (
                <>
                  <ModeButton
                    title={mutationState.isSaving ? 'Saving...' : 'Save learned rule'}
                    onPress={() => handleAiLearningMutation('edit')}
                    disabled={mutationState.isSaving}
                    testID="trainer-system-review-ai-learning-save"
                  />
                  <ModeButton
                    title="Approve learned rule"
                    variant="secondary"
                    onPress={() => handleAiLearningMutation('approve')}
                    disabled={mutationState.isSaving}
                    testID="trainer-system-review-ai-learning-approve"
                  />
                  <ModeButton
                    title="Reject learned rule"
                    variant="destructive"
                    onPress={() => handleAiLearningMutation('reject')}
                    disabled={mutationState.isSaving}
                    testID="trainer-system-review-ai-learning-reject"
                  />
                  <ModeButton
                    title="Delete suggestion"
                    variant="ghost"
                    onPress={() => handleAiLearningMutation('delete')}
                    disabled={mutationState.isSaving}
                    testID="trainer-system-review-ai-learning-delete"
                  />
                </>
              ) : null}
            </View>
          </View>
        ) : null}
      </SystemActionSheet>
    </SectionShell>
  );
}

function SystemAccountScreen({
  session,
  assignmentStatus,
  trainerSettings,
  bottomInset,
  onBack,
  onSignOut,
}) {
  const debugInfo = useMemo(() => getApiDebugInfo(), []);
  const email = valueOrFallback(session?.user?.email, 'No email found');
  const trainerName = valueOrFallback(
    assignmentStatus?.viewer_display_name || assignmentStatus?.assigned_trainer_display_name,
    'Trainer',
  );
  const appVersion = valueOrFallback(Constants.expoConfig?.version, 'dev');

  return (
    <SectionShell
      title="System Account"
      subtitle="Account, diagnostics, and sign-out moved into one dedicated screen."
      onBack={onBack}
      bottomInset={bottomInset}
    >
      <ModeCard variant="hero">
        <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>Account</ModeText>
        <DetailRow label="Email" value={email} />
        <DetailRow label="Trainer" value={trainerName} />
        <DetailRow
          label="Assistant"
          value={resolveAssistantDisplayName(trainerSettings?.assistant_display_name)}
        />
      </ModeCard>

      <SystemSectionCard>
        {SHOW_ACCOUNT_DIAGNOSTICS ? (
          <>
            <SystemSectionHeader title="Diagnostics" />
            <DetailRow label="Environment" value={environment} />
            <DetailRow label="Version" value={appVersion} />
            <DetailRow label="API Base" value={valueOrFallback(debugInfo.resolvedApiBaseUrl)} />
          </>
        ) : (
          <>
            <SystemSectionHeader title="App Info" />
            <DetailRow label="Version" value={appVersion} />
          </>
        )}
      </SystemSectionCard>

      <ModeButton
        title="Sign out"
        variant="destructive"
        onPress={onSignOut}
        testID="trainer-system-account-sign-out"
      />
    </SectionShell>
  );
}

function AtlasAdminReviewScreen({
  accessToken,
  bottomInset,
  onBack,
}) {
  const [isAllowed, setIsAllowed] = useState(false);
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);
  const [editedLearning, setEditedLearning] = useState('');
  const [reviewerNotes, setReviewerNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [mutationError, setMutationError] = useState(null);

  const loadAtlasQueue = useCallback(async () => {
    if (!accessToken || !ATLAS_ADMIN_REVIEW_ENABLED) {
      setIsAllowed(false);
      setItems([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const me = await getAtlasAdminMe({ accessToken });
      if (!me?.allowed) {
        setIsAllowed(false);
        setItems([]);
        return;
      }
      setIsAllowed(true);
      const response = await getAtlasAdminReviewQueue({ accessToken, status: 'pending', limit: 100 });
      setItems(Array.isArray(response) ? response : []);
    } catch (nextError) {
      setError(nextError?.message || 'Unable to load Atlas review queue.');
      setItems([]);
    } finally {
      setIsLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    loadAtlasQueue();
  }, [loadAtlasQueue]);

  const openItem = (item) => {
    setSelectedItem(item);
    setEditedLearning(String(item?.proposed_learning || ''));
    setReviewerNotes(String(item?.reviewer_notes || ''));
    setMutationError(null);
  };

  const runMutation = async (action) => {
    if (!selectedItem?.id || !accessToken || isSaving) {
      return;
    }
    setIsSaving(true);
    setMutationError(null);
    try {
      if (action === 'edit') {
        await updateAtlasAdminReviewQueueItem({
          accessToken,
          queueId: selectedItem.id,
          updates: {
            proposed_learning: editedLearning,
            reviewer_notes: reviewerNotes || null,
          },
        });
      } else if (action === 'approve') {
        const trimmedLearning = editedLearning.trim();
        if (trimmedLearning && trimmedLearning !== selectedItem.proposed_learning) {
          await updateAtlasAdminReviewQueueItem({
            accessToken,
            queueId: selectedItem.id,
            updates: {
              proposed_learning: trimmedLearning,
              reviewer_notes: reviewerNotes || null,
            },
          });
        }
        await approveAtlasAdminReviewQueueItem({
          accessToken,
          queueId: selectedItem.id,
          reviewerNotes,
        });
      } else {
        await rejectAtlasAdminReviewQueueItem({
          accessToken,
          queueId: selectedItem.id,
          reviewerNotes,
        });
      }
      await loadAtlasQueue();
      setSelectedItem(null);
    } catch (nextError) {
      setMutationError(nextError?.message || 'Unable to update Atlas review item.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SectionShell
      title="Atlas Review"
      subtitle="Internal privacy review for generalized coaching learnings."
      onBack={onBack}
      bottomInset={bottomInset}
      rightSlot={(
        <ModeButton
          title={isLoading ? 'Loading...' : 'Refresh'}
          variant="ghost"
          size="sm"
          onPress={loadAtlasQueue}
          disabled={isLoading}
          testID="trainer-system-atlas-review-refresh"
        />
      )}
    >
      {!ATLAS_ADMIN_REVIEW_ENABLED || (!isAllowed && !isLoading) ? (
        <SystemSectionCard>
          <EmptyListState
            title="Atlas review is unavailable"
            detail="This internal queue is hidden unless Atlas admin review is enabled and your account is allowed."
          />
        </SystemSectionCard>
      ) : null}

      {isLoading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={theme.colors.brand.progressCore} />
          <ModeText variant="bodySm" tone="secondary">Loading Atlas review queue...</ModeText>
        </View>
      ) : null}

      {!isLoading && error ? (
        <SystemSectionCard>
          <ModeText variant="bodySm" tone="error">{error}</ModeText>
        </SystemSectionCard>
      ) : null}

      {!isLoading && isAllowed && !error ? (
        <SystemSectionCard>
          <SystemSectionHeader title="Pending Learnings" />
          {items.length === 0 ? (
            <EmptyListState
              title="Nothing waiting right now"
              detail="Sanitized Atlas proposals will appear here before they can enter Atlas knowledge."
            />
          ) : items.map((item) => (
            <SystemNavRow
              key={item.id}
              icon="shield"
              title={item.proposed_learning || 'Atlas proposal'}
              subtitle={`${item.knowledge_type || 'learning'} · privacy ${Math.round(Number(item.privacy_risk_score || 0) * 100)}% · confidence ${Math.round(Number(item.confidence_score || 0) * 100)}%`}
              badge={item.reviewer_status || 'pending'}
              badgeVariant={Number(item.privacy_risk_score || 0) >= 0.15 ? 'warning' : 'default'}
              onPress={() => openItem(item)}
              testID={`trainer-system-atlas-review-row-${item.id}`}
            />
          ))}
        </SystemSectionCard>
      ) : null}

      <SystemActionSheet
        visible={Boolean(selectedItem)}
        onClose={() => setSelectedItem(null)}
        testID="trainer-system-atlas-review-sheet"
      >
        {selectedItem ? (
          <View style={styles.sheetContent}>
            <ModeText variant="label" tone="tertiary">Sanitized Proposal</ModeText>
            <ModeText variant="caption" tone="secondary">
              {selectedItem.knowledge_type} · Privacy {Math.round(Number(selectedItem.privacy_risk_score || 0) * 100)}% · Confidence {Math.round(Number(selectedItem.confidence_score || 0) * 100)}%
            </ModeText>
            {Array.isArray(selectedItem.privacy_flags) && selectedItem.privacy_flags.length > 0 ? (
              <ModeText variant="caption" tone="secondary">
                Flags: {selectedItem.privacy_flags.join(', ')}
              </ModeText>
            ) : null}
            <ModeInput
              value={editedLearning}
              onChangeText={setEditedLearning}
              placeholder="Edit generalized learning"
              multiline
              style={styles.multilineInput}
              testID="trainer-system-atlas-review-learning-input"
            />
            <ModeInput
              value={reviewerNotes}
              onChangeText={setReviewerNotes}
              placeholder="Reviewer notes"
              multiline
              style={styles.multilineInput}
              testID="trainer-system-atlas-review-notes-input"
            />
            {mutationError ? (
              <ModeText variant="caption" tone="error">{mutationError}</ModeText>
            ) : null}
            <View style={styles.buttonStack}>
              <ModeButton
                title={isSaving ? 'Saving...' : 'Save edit'}
                onPress={() => runMutation('edit')}
                disabled={isSaving}
                testID="trainer-system-atlas-review-save"
              />
              <ModeButton
                title="Approve"
                variant="secondary"
                onPress={() => runMutation('approve')}
                disabled={isSaving}
                testID="trainer-system-atlas-review-approve"
              />
              <ModeButton
                title="Reject"
                variant="destructive"
                onPress={() => runMutation('reject')}
                disabled={isSaving}
                testID="trainer-system-atlas-review-reject"
              />
            </View>
          </View>
        ) : null}
      </SystemActionSheet>
    </SectionShell>
  );
}

export default function TrainerSystemScreen({
  accessToken,
  bottomInset = 0,
  assignmentStatus,
  session,
  onSignOut,
  onOpenTrainerCoach,
}) {
  const [viewStack, setViewStack] = useState([{ key: SYSTEM_VIEW.HUB, params: null }]);
  const [hubCounts, setHubCounts] = useState({ clients: 0, knowledge: 0, review: 0 });
  const [trainerSettings, setTrainerSettings] = useState(null);
  const [trainerPersona, setTrainerPersona] = useState(null);
  const [isLoadingTrainerSettings, setIsLoadingTrainerSettings] = useState(false);
  const [showAtlasAdminReview, setShowAtlasAdminReview] = useState(false);

  const onboardingState = useMemo(
    () => buildOnboardingState({
      trainerOnboardingCompleted: Boolean(assignmentStatus?.trainer_onboarding_completed),
      trainerOnboardingStatus: assignmentStatus?.trainer_onboarding_status || 'not_started',
      trainerOnboardingCompletedSteps: assignmentStatus?.trainer_onboarding_completed_steps ?? 0,
      trainerOnboardingTotalSteps: assignmentStatus?.trainer_onboarding_total_steps ?? 8,
      trainerOnboardingLastStep: assignmentStatus?.trainer_onboarding_last_step || null,
    }),
    [assignmentStatus],
  );

  const trainerName = useMemo(() => (
    valueOrFallback(
      assignmentStatus?.viewer_display_name
        || assignmentStatus?.assigned_trainer_display_name
        || session?.user?.email?.split('@')?.[0],
      'Trainer',
    )
  ), [assignmentStatus, session]);

  const hubSubtitle = useMemo(() => {
    const assistantName = resolveAssistantDisplayName(trainerSettings?.assistant_display_name);
    if (onboardingState.onboardingComplete) {
      return `${assistantName} is calibrated and ready for trainer-controlled coaching.`;
    }
    if (onboardingState.onboardingInProgress) {
      return `${assistantName} is still being calibrated. Resume when you are ready.`;
    }
    return 'Build your AI coaching layer with compact, drill-down controls.';
  }, [onboardingState, trainerSettings]);

  const coachSummary = useMemo(() => buildCoachWorkspaceSummary({
    trainerName,
    trainerSettings,
    trainerPersona,
  }), [trainerName, trainerPersona, trainerSettings]);

  const currentView = viewStack[viewStack.length - 1] || { key: SYSTEM_VIEW.HUB, params: null };

  const pushView = useCallback((key, params = null) => {
    setViewStack((current) => [...current, { key, params }]);
  }, []);

  const popView = useCallback(() => {
    setViewStack((current) => (current.length > 1 ? current.slice(0, -1) : current));
  }, []);

  const refreshHubCounts = useCallback(async () => {
    if (!accessToken) {
      setHubCounts({ clients: 0, knowledge: 0, review: 0 });
      return;
    }
    try {
      const [knowledgeResponse, clientsResponse, draftResponse, outputResponse, qaResponse, aiLearningResponse] = await Promise.all([
        listTrainerKnowledgeEntries({ accessToken, includeArchived: false, limit: 220, offset: 0 }),
        listTrainerClients({ accessToken, limit: 1, offset: 0 }),
        getTrainerCoachQueue({ accessToken, limit: 50 }),
        getTrainerReviewOutputs({ accessToken, status: 'open', limit: 50, offset: 0 }),
        requestTrainerReviewQueue({ accessToken }),
        getTrainerAiReviewQueue({ accessToken, status: 'pending', limit: 50 }).catch(() => []),
      ]);
      const clientsCount = normalizeListPayload(clientsResponse).count;
      const knowledgeCount = Array.isArray(knowledgeResponse)
        ? knowledgeResponse.filter((entry) => entry?.status !== 'archived').length
        : 0;
      const draftCount = normalizeListPayload(draftResponse).count;
      const outputCount = normalizeListPayload(outputResponse).count;
      const qaCount = Array.isArray(qaResponse) ? qaResponse.length : 0;
      const aiLearningCount = Array.isArray(aiLearningResponse) ? aiLearningResponse.length : 0;
      setHubCounts({
        clients: clientsCount,
        knowledge: knowledgeCount,
        review: draftCount + outputCount + qaCount + aiLearningCount,
      });
    } catch (_error) {
      setHubCounts((current) => current);
    }
  }, [accessToken]);

  const loadTrainerSettings = useCallback(async () => {
    if (!accessToken) {
      setTrainerSettings(null);
      return;
    }
    setIsLoadingTrainerSettings(true);
    try {
      const payload = await getTrainerSettingsMe({ accessToken });
      setTrainerSettings(payload);
    } catch (_error) {
      setTrainerSettings(null);
    } finally {
      setIsLoadingTrainerSettings(false);
    }
  }, [accessToken]);

  const loadTrainerPersona = useCallback(async () => {
    if (!accessToken) {
      setTrainerPersona(null);
      return;
    }
    try {
      const payload = await listTrainerPersonas({ accessToken });
      setTrainerPersona(pickDefaultTrainerPersona(payload));
    } catch (_error) {
      setTrainerPersona(null);
    }
  }, [accessToken]);

  useEffect(() => {
    refreshHubCounts();
    loadTrainerSettings();
    loadTrainerPersona();
  }, [loadTrainerPersona, refreshHubCounts, loadTrainerSettings]);

  useEffect(() => {
    let isMounted = true;
    const loadAtlasAdminAccess = async () => {
      if (!accessToken || !ATLAS_ADMIN_REVIEW_ENABLED) {
        setShowAtlasAdminReview(false);
        return;
      }
      try {
        const payload = await getAtlasAdminMe({ accessToken });
        if (isMounted) {
          setShowAtlasAdminReview(Boolean(payload?.allowed));
        }
      } catch (_error) {
        if (isMounted) {
          setShowAtlasAdminReview(false);
        }
      }
    };
    loadAtlasAdminAccess();
    return () => {
      isMounted = false;
    };
  }, [accessToken]);

  const handleTrainerSettingsSaved = useCallback((payload) => {
    setTrainerSettings(payload);
  }, []);

  const commonViewProps = {
    accessToken,
    bottomInset,
  };

  if (currentView.key === SYSTEM_VIEW.COACH_WORKSPACE) {
    return (
      <CoachWorkspaceScreen
        bottomInset={bottomInset}
        onBack={popView}
        trainerName={trainerName}
        onboardingState={onboardingState}
        coachSummary={coachSummary}
        onOpenTrainerCoach={onOpenTrainerCoach}
      />
    );
  }

  if (currentView.key === SYSTEM_VIEW.KNOWLEDGE_WORKSPACE) {
    return (
      <KnowledgeWorkspaceScreen
        {...commonViewProps}
        onBack={popView}
        onKnowledgeMutated={refreshHubCounts}
      />
    );
  }

  if (currentView.key === SYSTEM_VIEW.DEFAULTS_SESSION) {
    return (
      <DefaultsSessionScreen
        accessToken={accessToken}
        bottomInset={bottomInset}
        onBack={popView}
        trainerSettings={trainerSettings}
        isLoadingTrainerSettings={isLoadingTrainerSettings}
        onTrainerSettingsSaved={handleTrainerSettingsSaved}
      />
    );
  }

  if (currentView.key === SYSTEM_VIEW.DEFAULTS_COMMUNICATION) {
    return (
      <DefaultsCommunicationScreen
        accessToken={accessToken}
        bottomInset={bottomInset}
        onBack={popView}
        trainerSettings={trainerSettings}
        isLoadingTrainerSettings={isLoadingTrainerSettings}
        onTrainerSettingsSaved={handleTrainerSettingsSaved}
      />
    );
  }

  if (currentView.key === SYSTEM_VIEW.CLIENTS_LIST) {
    return (
      <ClientsListScreen
        {...commonViewProps}
        onBack={popView}
        onOpenClientManagement={() => pushView(SYSTEM_VIEW.CLIENT_MANAGEMENT)}
        onOpenClientDetail={(clientId) => pushView(SYSTEM_VIEW.CLIENT_DETAIL_MANAGEMENT, { clientId })}
      />
    );
  }

  if (currentView.key === SYSTEM_VIEW.CLIENT_MANAGEMENT) {
    return (
      <ClientManagementScreen
        {...commonViewProps}
        onBack={popView}
        onOpenClientDetail={(clientId) => pushView(SYSTEM_VIEW.CLIENT_DETAIL_MANAGEMENT, { clientId })}
        onClientsMutated={refreshHubCounts}
      />
    );
  }

  if (currentView.key === SYSTEM_VIEW.CLIENT_DETAIL_MANAGEMENT) {
    return (
      <ClientDetailManagementScreen
        {...commonViewProps}
        onBack={popView}
        clientId={currentView.params?.clientId || null}
      />
    );
  }

  if (currentView.key === SYSTEM_VIEW.REVIEW_HUB) {
    return (
      <ReviewHubScreen
        {...commonViewProps}
        onBack={popView}
        onReviewMutated={refreshHubCounts}
      />
    );
  }

  if (currentView.key === SYSTEM_VIEW.ATLAS_ADMIN_REVIEW && showAtlasAdminReview) {
    return (
      <AtlasAdminReviewScreen
        {...commonViewProps}
        onBack={popView}
      />
    );
  }

  if (currentView.key === SYSTEM_VIEW.SYSTEM_ACCOUNT) {
    return (
      <SystemAccountScreen
        session={session}
        assignmentStatus={assignmentStatus}
        trainerSettings={trainerSettings}
        bottomInset={bottomInset}
        onBack={popView}
        onSignOut={onSignOut}
      />
    );
  }

  return (
    <TrainerSystemHubScreen
      bottomInset={bottomInset}
      trainerName={trainerName}
      subtitle={hubSubtitle}
      counts={hubCounts}
      onboardingState={onboardingState}
      onNavigate={pushView}
      showAtlasAdminReview={showAtlasAdminReview}
    />
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: theme.colors.surface.canvas,
  },
  content: {
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[3],
    gap: theme.spacing[2],
  },
  headerIconButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: theme.colors.glass.borderSoft,
    backgroundColor: theme.colors.glass.base,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  headerIconButtonPressed: {
    opacity: theme.interaction.pressedOpacity,
    transform: [{ scale: theme.interaction.pressedScale }],
  },
  sectionLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: theme.spacing[1],
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[1],
    minHeight: 48,
  },
  emptyState: {
    minHeight: 72,
    justifyContent: 'center',
    gap: 4,
    paddingVertical: theme.spacing[1],
  },
  detailRow: {
    gap: 4,
    paddingVertical: 6,
  },
  detailValue: {
    lineHeight: theme.typography.body2.lineHeight,
  },
  toggleRow: {
    minHeight: 56,
    borderWidth: 1,
    borderColor: theme.colors.border.soft,
    backgroundColor: theme.colors.surface.base,
    borderRadius: theme.radii.m,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[2],
  },
  toggleCopy: {
    flex: 1,
    gap: 4,
  },
  segmentedWrap: {
    flexDirection: 'row',
    gap: 6,
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    borderColor: theme.colors.border.soft,
    backgroundColor: theme.colors.surface.elevated,
    padding: 4,
  },
  segmentButton: {
    flex: 1,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radii.pill,
    paddingHorizontal: theme.spacing[2],
  },
  segmentButtonActive: {
    backgroundColor: theme.colors.nav.activeBg,
    borderWidth: 1,
    borderColor: theme.colors.nav.activeBorder,
  },
  segmentButtonPressed: {
    opacity: theme.interaction.pressedOpacity,
  },
  segmentLabel: {
    fontWeight: '700',
    textAlign: 'center',
  },
  buttonStack: {
    gap: theme.spacing[1],
  },
  knowledgeWorkspaceTopActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: theme.spacing[1],
  },
  noteRowGroup: {
    gap: 4,
  },
  noteRow: {
    minHeight: 56,
    borderRadius: theme.radii.s,
    borderWidth: 1,
    borderColor: theme.colors.border.soft,
    backgroundColor: theme.colors.surface.base,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[2],
  },
  noteRowPressed: {
    opacity: theme.interaction.pressedOpacity,
  },
  noteRowCopy: {
    flex: 1,
    gap: 4,
  },
  noteRowTitle: {
    fontWeight: '600',
  },
  noteRowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[1],
  },
  noteRowIconButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: theme.colors.glass.borderSoft,
    backgroundColor: theme.colors.glass.base,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noteRowIconButtonPressed: {
    opacity: theme.interaction.pressedOpacity,
    transform: [{ scale: theme.interaction.pressedScale }],
  },
  multilineInput: {
    minHeight: 150,
  },
  multilineInputCompact: {
    minHeight: 86,
  },
  refinementActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[1],
  },
  refinementComposer: {
    gap: theme.spacing[1],
  },
  sheetContent: {
    gap: theme.spacing[2],
  },
  sheetTitle: {
    fontWeight: '600',
  },
  assistantPreviewCard: {
    borderWidth: 1,
    borderColor: theme.colors.border.soft,
    backgroundColor: theme.colors.surface.base,
    borderRadius: theme.radii.s,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    gap: 6,
  },
  assistantPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  managementRow: {
    minHeight: 56,
    borderWidth: 1,
    borderColor: theme.colors.border.soft,
    backgroundColor: theme.colors.surface.base,
    borderRadius: theme.radii.s,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[2],
  },
  managementRowPressed: {
    opacity: theme.interaction.pressedOpacity,
    transform: [{ scale: theme.interaction.pressedScale }],
  },
  managementCopy: {
    flex: 1,
    gap: 4,
  },
  managementIconButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: theme.colors.glass.borderSoft,
    backgroundColor: theme.colors.glass.base,
    alignItems: 'center',
    justifyContent: 'center',
  },
  managementIconButtonDisabled: {
    opacity: 0.55,
  },
  systemMemoryCard: {
    gap: theme.spacing[1],
  },
  systemMemoryHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[1],
  },
  systemMemorySectionLabel: {
    marginBottom: 0,
  },
  systemMemoryComposer: {
    gap: theme.spacing[1],
  },
  systemMemoryComposerMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[1],
  },
  systemMemoryComposerInput: {
    flex: 1,
    minHeight: 48,
    marginVertical: 0,
  },
  systemMemoryComposerSubmitButton: {
    width: 40,
    height: 40,
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    borderColor: theme.colors.nav.activeBorder,
    backgroundColor: theme.colors.nav.activeBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  systemMemoryComposerSubmitButtonDisabled: {
    opacity: theme.interaction.disabledOpacity,
  },
  systemMemoryComposerSubmitButtonPressed: {
    opacity: theme.interaction.pressedOpacity,
    transform: [{ scale: theme.interaction.pressedScale }],
  },
  systemMemoryComposerSecondaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[1],
  },
  systemMemoryVisibilitySegmented: {
    flex: 1,
    flexDirection: 'row',
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    borderColor: theme.colors.border.soft,
    backgroundColor: theme.colors.surface.elevated,
    padding: 4,
    gap: 4,
  },
  systemMemorySegmentButton: {
    flex: 1,
    minHeight: 32,
    borderRadius: theme.radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing[1],
  },
  systemMemorySegmentButtonActive: {
    backgroundColor: theme.colors.nav.activeBg,
    borderWidth: 1,
    borderColor: theme.colors.nav.activeBorder,
  },
  systemMemorySegmentButtonPressed: {
    opacity: theme.interaction.pressedOpacity,
  },
  systemMemorySegmentLabel: {
    fontWeight: '700',
  },
  systemMemoryTagsAction: {
    minHeight: 32,
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    borderColor: theme.colors.glass.borderSoft,
    backgroundColor: theme.colors.surface.elevated,
    paddingHorizontal: theme.spacing[1],
    alignItems: 'center',
    justifyContent: 'center',
  },
  systemMemoryTagsActionPressed: {
    opacity: theme.interaction.pressedOpacity,
  },
  systemMemoryTagsActionText: {
    fontWeight: '600',
  },
  systemMemoryComposerMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[1],
  },
  systemMemoryVisibilitySegment: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    flex: 1,
  },
  systemMemoryTagsInput: {
    marginVertical: 0,
  },
  systemMemoryFilterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: theme.spacing[1],
    marginTop: theme.spacing[1],
  },
  systemMemoryFilterChip: {
    minHeight: 28,
    minWidth: 40,
  },
  systemMemoryInlineFeedback: {
    marginTop: theme.spacing[1],
  },
  systemMemoryDenseList: {
    gap: theme.spacing[1],
    marginTop: theme.spacing[2],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border.soft,
    paddingTop: theme.spacing[2],
  },
  systemMemorySwipeRowWrap: {
    position: 'relative',
  },
  systemMemorySwipeTestHook: {
    width: 0,
    height: 0,
    opacity: 0,
  },
  systemMemorySwipeActionsLayer: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'space-between',
    overflow: 'hidden',
    borderRadius: theme.radii.s,
    borderWidth: 1,
    borderColor: theme.colors.border.soft,
    backgroundColor: theme.colors.surface.base,
  },
  systemMemorySwipeActionLeft: {
    width: MEMORY_SWIPE_REVEAL_DISTANCE,
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingLeft: theme.spacing[1],
  },
  systemMemorySwipeActionRight: {
    width: MEMORY_SWIPE_REVEAL_DISTANCE,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingRight: theme.spacing[1],
  },
  systemMemorySwipeActionButton: {
    minHeight: 32,
    minWidth: 56,
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    paddingHorizontal: theme.spacing[1],
    alignItems: 'center',
    justifyContent: 'center',
  },
  systemMemorySwipeActionEdit: {
    borderColor: theme.colors.nav.activeBorder,
    backgroundColor: theme.colors.nav.activeBg,
  },
  systemMemorySwipeActionArchive: {
    borderColor: theme.colors.feedback.errorBorder,
    backgroundColor: theme.colors.feedback.errorBg,
  },
  systemMemorySwipeActionButtonPressed: {
    opacity: theme.interaction.pressedOpacity,
  },
  systemMemorySwipeActionLabel: {
    fontWeight: '700',
  },
  systemMemorySwipeTrack: {
    position: 'relative',
  },
  systemMemoryDenseRow: {
    minHeight: 56,
    borderWidth: 1,
    borderColor: theme.colors.border.soft,
    backgroundColor: theme.colors.surface.base,
    borderRadius: theme.radii.s,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[1],
  },
  systemMemoryDenseRowPressed: {
    opacity: theme.interaction.pressedOpacity,
  },
  systemMemoryDenseRowMain: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  systemMemoryDenseRowText: {
    fontWeight: '600',
  },
  systemMemoryDenseRowMeta: {
    lineHeight: theme.typography.body3.lineHeight,
  },
  systemMemoryIconButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.glass.borderSoft,
    backgroundColor: theme.colors.glass.base,
    alignItems: 'center',
    justifyContent: 'center',
  },
  systemMemoryIconButtonPressed: {
    opacity: theme.interaction.pressedOpacity,
    transform: [{ scale: theme.interaction.pressedScale }],
  },
  systemMemoryEditHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[1],
  },
  systemMemoryEditHeaderCopy: {
    flex: 1,
    gap: 4,
  },
});

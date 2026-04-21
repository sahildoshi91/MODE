import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import Constants from 'expo-constants';

import {
  HeaderBar,
  ModeButton,
  ModeCard,
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
import { getApiDebugInfo } from '../../../services/apiBaseUrl';
import { fetchWithApiFallback } from '../../../services/apiRequest';
import { TRAINER_AGENT_LAB_ENABLED } from '../../../config/featureFlags';
import {
  ASSISTANT_DISPLAY_NAME_MAX_LENGTH,
  prepareAssistantDisplayNameForSave,
  resolveAssistantDisplayName,
} from '../../messaging';
import {
  archiveTrainerRule,
  createTrainerKnowledgeDocument,
  deleteTrainerKnowledgeDocument,
  listTrainerKnowledgeDocuments,
  listTrainerRules,
  saveTrainerKnowledgeDocumentWithFallback,
  updateTrainerKnowledgeDocument,
  updateTrainerRule,
} from '../../trainerHome/services/trainerKnowledgeApi';
import {
  createTrainerInviteCode,
  deactivateTrainerInviteCode,
  getTrainerClientAIContext,
  getTrainerClientDetail,
  listTrainerClients,
  listTrainerInviteCodes,
  removeTrainerClient,
  updateTrainerClient,
} from '../../trainerClients/services/trainerHomeApi';
import {
  getTrainerSettingsMe,
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
import { formatIsoWeekdaySummary } from '../../trainerClients/utils/scheduleResolver';

const RULE_CATEGORY_LABELS = {
  training_philosophy: 'Training Philosophy',
  nutrition_philosophy: 'Nutrition Philosophy',
  progression_logic: 'Progression Logic',
  recovery_deload_logic: 'Recovery / Deload Logic',
  motivational_style: 'Motivational Style',
  communication_tone: 'Communication Tone',
  adjustment_rules: 'Adjustment Rules',
  contraindications: 'Contraindications',
  general_coaching: 'General Coaching',
};

const SYSTEM_VIEW = {
  HUB: 'hub',
  COACH_PROFILE: 'coach_profile',
  COACH_SETTINGS: 'coach_settings',
  COACH_RETRAIN_REVIEW: 'coach_retrain_review',
  KNOWLEDGE_MEMORY_BANK: 'knowledge_memory_bank',
  KNOWLEDGE_METHODOLOGY_RULES: 'knowledge_methodology_rules',
  KNOWLEDGE_QUICK_CAPTURES: 'knowledge_quick_captures',
  DEFAULTS_SESSION: 'defaults_session',
  DEFAULTS_COMMUNICATION: 'defaults_communication',
  CLIENTS_LIST: 'clients_list',
  CLIENT_MANAGEMENT: 'client_management',
  CLIENT_DETAIL_MANAGEMENT: 'client_detail_management',
  REVIEW_HUB: 'review_hub',
  SYSTEM_ACCOUNT: 'system_account',
};

const REVIEW_SEGMENT = {
  DRAFTS: 'drafts',
  OUTPUTS: 'outputs',
  QA: 'qa',
};

const environment = __DEV__ ? 'Development' : 'Production';

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

function formatRuleCategory(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return RULE_CATEGORY_LABELS.general_coaching;
  }
  const normalized = value.trim().toLowerCase();
  return RULE_CATEGORY_LABELS[normalized]
    || normalized.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
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

function isExtractionSoftNote(reason) {
  return typeof reason === 'string' && (
    reason.startsWith('extractor_exception:')
    || reason.startsWith('rule_persistence_exception:')
    || reason === 'ingest_request_failed'
    || reason === 'tenant_context_missing_for_extraction'
  );
}

function generateInviteCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let index = 0; index < 6; index += 1) {
    suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `MODE${suffix}`;
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
  isRefreshing,
  onRefresh,
}) {
  return (
    <SectionShell
      title="System"
      subtitle="Trainer control center"
      bottomInset={bottomInset}
      rightSlot={(
        <ModeButton
          title={isRefreshing ? 'Refreshing...' : 'Refresh'}
          variant="ghost"
          size="sm"
          onPress={onRefresh}
          disabled={isRefreshing}
          testID="trainer-system-refresh"
        />
      )}
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
        <SystemSectionHeader title="Coach" />
        <SystemNavRow
          icon="user"
          title="Coach Profile"
          subtitle={onboardingState.onboardingComplete
            ? 'Coach profile is calibrated and ready.'
            : onboardingState.onboardingInProgress
              ? `${onboardingState.completedSteps} of ${onboardingState.totalSteps} steps completed`
              : 'Complete onboarding and define your coaching layer.'}
          badge={onboardingState.onboardingComplete ? null : `${onboardingState.completedSteps}/${onboardingState.totalSteps}`}
          badgeVariant="accent"
          onPress={() => onNavigate(SYSTEM_VIEW.COACH_PROFILE)}
          testID="trainer-system-nav-coach-profile"
        />
        <SystemNavRow
          icon="sliders"
          title="Coach Settings"
          subtitle="Centralize profile calibration and workspace behavior."
          onPress={() => onNavigate(SYSTEM_VIEW.COACH_SETTINGS)}
          testID="trainer-system-nav-coach-settings"
        />
        <SystemNavRow
          icon="refresh-cw"
          title="Review / Retrain Coach"
          subtitle="Open review, retrain, or resume onboarding with the same launch context."
          badge={onboardingState.onboardingComplete ? null : 'Live'}
          badgeVariant={onboardingState.onboardingComplete ? 'default' : 'warning'}
          onPress={() => onNavigate(SYSTEM_VIEW.COACH_RETRAIN_REVIEW)}
          testID="trainer-system-nav-coach-retrain-review"
        />
      </SystemSectionCard>

      <SystemSectionCard>
        <SystemSectionHeader title="Knowledge" />
        <SystemNavRow
          icon="database"
          title="Memory Bank"
          subtitle="Search, edit, and archive saved knowledge documents."
          badge={counts.knowledge > 0 ? counts.knowledge : null}
          badgeVariant="accent"
          onPress={() => onNavigate(SYSTEM_VIEW.KNOWLEDGE_MEMORY_BANK)}
          testID="trainer-system-nav-knowledge-memory-bank"
        />
        <SystemNavRow
          icon="book-open"
          title="Methodology / Rules"
          subtitle="Manage long-form methodology and extracted coaching rules."
          onPress={() => onNavigate(SYSTEM_VIEW.KNOWLEDGE_METHODOLOGY_RULES)}
          testID="trainer-system-nav-knowledge-methodology-rules"
        />
        <SystemNavRow
          icon="zap"
          title="Quick Captures"
          subtitle="Save fast coaching cues without leaving the workflow."
          onPress={() => onNavigate(SYSTEM_VIEW.KNOWLEDGE_QUICK_CAPTURES)}
          testID="trainer-system-nav-knowledge-quick-captures"
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
        <SystemSectionHeader title="Clients" />
        <SystemNavRow
          icon="users"
          title="Client List"
          subtitle="Open client summaries and detail management."
          badge={counts.clients > 0 ? counts.clients : null}
          badgeVariant="accent"
          onPress={() => onNavigate(SYSTEM_VIEW.CLIENTS_LIST)}
          testID="trainer-system-nav-clients-list"
        />
        <SystemNavRow
          icon="user-plus"
          title="Add / Edit / Remove Clients"
          subtitle="Manage assignments and invite codes without leaving System."
          onPress={() => onNavigate(SYSTEM_VIEW.CLIENT_MANAGEMENT)}
          testID="trainer-system-nav-client-management"
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

function CoachProfileScreen({ bottomInset, onBack, trainerName, onboardingState, onOpenTrainerCoach }) {
  const statusLabel = onboardingState.onboardingComplete
    ? 'Completed'
    : onboardingState.onboardingInProgress
      ? 'In progress'
      : 'Not started';

  return (
    <SectionShell
      title="Coach Profile"
      subtitle="Train how your AI coach should sound and decide."
      onBack={onBack}
      bottomInset={bottomInset}
    >
      <ModeCard variant="hero">
        <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>Status</ModeText>
        <DetailRow label="Trainer" value={trainerName} />
        <DetailRow label="Onboarding" value={statusLabel} />
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
        <ModeText variant="bodySm">Build the system prompt, methodology, review loop, and decision style your coach should apply.</ModeText>
        <ModeText variant="caption" tone="secondary">
          Use this when you want to continue calibration without hunting through stacked cards.
        </ModeText>
        <ModeButton
          title={onboardingState.onboardingInProgress ? 'Resume coach onboarding' : 'Continue coach onboarding'}
          variant="secondary"
          onPress={() => onOpenTrainerCoach?.({
            entrypoint: 'trainer_agent_training',
            onboarding_action: onboardingState.primaryAction,
          })}
          testID="trainer-system-coach-profile-primary"
        />
      </ModeCard>
    </SectionShell>
  );
}

function CoachSettingsScreen({ bottomInset, onBack, onboardingState, onNavigate }) {
  return (
    <SectionShell
      title="Coach Settings"
      subtitle="Centralized calibration entry points for your AI coaching layer."
      onBack={onBack}
      bottomInset={bottomInset}
    >
      <ModeCard variant="hero">
        <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>Calibration</ModeText>
        <ModeText variant="bodySm">
          {onboardingState.onboardingComplete
            ? 'Your coach profile is complete. Review or retrain when your methodology shifts.'
            : 'Your coach profile is still being calibrated. Continue from where you left off.'}
        </ModeText>
      </ModeCard>

      <SystemSectionCard>
        <SystemSectionHeader title="Actions" />
        <SystemNavRow
          icon="refresh-cw"
          title="Review / Retrain Coach"
          subtitle="Open the dedicated action screen with review, retrain, and resume controls."
          onPress={() => onNavigate(SYSTEM_VIEW.COACH_RETRAIN_REVIEW)}
          testID="trainer-system-coach-settings-review"
        />
        <SystemNavRow
          icon="user"
          title="Coach Profile"
          subtitle="See onboarding progress and launch the next calibration step."
          onPress={() => onNavigate(SYSTEM_VIEW.COACH_PROFILE)}
          testID="trainer-system-coach-settings-profile"
        />
      </SystemSectionCard>
    </SectionShell>
  );
}

function CoachRetrainReviewScreen({ bottomInset, onBack, onboardingState, onOpenTrainerCoach }) {
  return (
    <SectionShell
      title="Review / Retrain"
      subtitle="Preserve existing coach-launch payloads while giving them a cleaner home."
      onBack={onBack}
      bottomInset={bottomInset}
    >
      <ModeCard variant="surface">
        <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>Coach Actions</ModeText>
        <ModeText variant="bodySm" tone="secondary">
          Continue or resume onboarding, open coach review, or retrain your coach after methodology changes.
        </ModeText>
        <View style={styles.buttonStack}>
          <ModeButton
            title={onboardingState.onboardingInProgress ? 'Resume onboarding' : 'Continue onboarding'}
            onPress={() => onOpenTrainerCoach?.({
              entrypoint: 'trainer_agent_training',
              onboarding_action: onboardingState.primaryAction,
            })}
            testID="trainer-system-coach-review-primary"
          />
          <ModeButton
            title="Review coach"
            variant="ghost"
            onPress={() => onOpenTrainerCoach?.({
              entrypoint: 'trainer_agent_training',
              onboarding_action: 'review',
            })}
            testID="trainer-system-coach-review-button"
          />
          <ModeButton
            title="Retrain coach"
            variant="secondary"
            onPress={() => onOpenTrainerCoach?.({
              entrypoint: 'trainer_agent_training',
              onboarding_action: 'retrain',
            })}
            testID="trainer-system-coach-retrain-button"
          />
        </View>
      </ModeCard>
    </SectionShell>
  );
}

function KnowledgeQuickCapturesScreen({
  accessToken,
  bottomInset,
  onBack,
  onKnowledgeMutated,
}) {
  const [quickCaptureText, setQuickCaptureText] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState({ error: null, note: null, success: null });

  const handleSave = async () => {
    const trimmed = quickCaptureText.trim();
    if (!trimmed) {
      setFeedback({
        error: 'Share one coaching principle before saving quick capture.',
        note: null,
        success: null,
      });
      return;
    }
    if (!accessToken || isSaving) {
      return;
    }
    setIsSaving(true);
    setFeedback({ error: null, note: null, success: null });
    try {
      const payload = await saveTrainerKnowledgeDocumentWithFallback({
        accessToken,
        title: `Quick Capture - ${new Date().toLocaleString()}`,
        rawText: trimmed,
        metadata: {
          source: 'agent_lab_quick_capture',
        },
      });
      const createdCount = payload?.extraction?.rules_created;
      const extractionFallbackReason = payload?.extraction?.fallback_reason;
      setFeedback({
        error: null,
        note: isExtractionSoftNote(extractionFallbackReason)
          ? 'Rule extraction is still processing. You can retry later.'
          : null,
        success: typeof createdCount === 'number'
          ? `Saved and extracted ${createdCount} coaching rule${createdCount === 1 ? '' : 's'}.`
          : 'Saved and extracted coaching rules for review.',
      });
      setQuickCaptureText('');
      onKnowledgeMutated?.();
    } catch (error) {
      setFeedback({
        error: error?.message || 'Unable to save trainer knowledge.',
        note: null,
        success: null,
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SectionShell
      title="Quick Captures"
      subtitle="Save one rule, principle, or cue without expanding the whole workspace."
      onBack={onBack}
      bottomInset={bottomInset}
    >
      <ModeCard variant="surface">
        <ModeText variant="bodySm" tone="secondary">
          Quick captures land in your memory bank and kick off rule extraction when available.
        </ModeText>
        <ModeInput
          value={quickCaptureText}
          onChangeText={setQuickCaptureText}
          placeholder="Example: If stress is high, lower intensity before changing frequency."
          multiline
          style={styles.quickCaptureInput}
          testID="trainer-system-quick-capture-input"
        />
        {feedback.error ? (
          <ModeText variant="caption" tone="error">{feedback.error}</ModeText>
        ) : null}
        {feedback.note ? (
          <ModeText variant="caption" tone="secondary">{feedback.note}</ModeText>
        ) : null}
        {feedback.success ? (
          <ModeText variant="caption" tone="success">{feedback.success}</ModeText>
        ) : null}
        <ModeButton
          title={isSaving ? 'Saving...' : 'Save quick capture'}
          onPress={handleSave}
          disabled={isSaving}
          testID="trainer-system-quick-capture-save"
        />
      </ModeCard>
    </SectionShell>
  );
}

function KnowledgeMemoryBankScreen({
  accessToken,
  bottomInset,
  onBack,
  onKnowledgeMutated,
}) {
  const [documents, setDocuments] = useState([]);
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [selectedDocument, setSelectedDocument] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftRawText, setDraftRawText] = useState('');
  const [mutationState, setMutationState] = useState({
    isSaving: false,
    isDeleting: false,
    error: null,
    note: null,
    success: null,
  });

  const loadDocuments = useCallback(async ({ refresh = false } = {}) => {
    if (!accessToken) {
      setDocuments([]);
      setIsLoading(false);
      return;
    }
    if (refresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);
    try {
      const payload = await listTrainerKnowledgeDocuments({ accessToken });
      setDocuments(Array.isArray(payload) ? payload : []);
    } catch (nextError) {
      setError(nextError?.message || 'Unable to load trainer knowledge.');
    } finally {
      if (refresh) {
        setIsRefreshing(false);
      } else {
        setIsLoading(false);
      }
    }
  }, [accessToken]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  const filteredDocuments = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const sorted = [...documents].sort((left, right) => (
      String(right?.created_at || '').localeCompare(String(left?.created_at || ''))
    ));
    if (!normalizedQuery) {
      return sorted;
    }
    return sorted.filter((document) => (
      String(document?.title || '').toLowerCase().includes(normalizedQuery)
      || String(document?.raw_text || '').toLowerCase().includes(normalizedQuery)
    ));
  }, [documents, query]);

  const openDocument = (document) => {
    setSelectedDocument(document);
    setDraftTitle(String(document?.title || ''));
    setDraftRawText(String(document?.raw_text || ''));
    setIsEditing(false);
    setMutationState({
      isSaving: false,
      isDeleting: false,
      error: null,
      note: null,
      success: null,
    });
  };

  const handleSaveDocument = async () => {
    if (!selectedDocument?.id || !accessToken || mutationState.isSaving) {
      return;
    }
    const normalizedTitle = draftTitle.trim();
    const normalizedRawText = draftRawText.trim();
    if (!normalizedTitle) {
      setMutationState((current) => ({
        ...current,
        error: 'Add a title before saving.',
      }));
      return;
    }
    if (!normalizedRawText) {
      setMutationState((current) => ({
        ...current,
        error: 'Add coaching content before saving.',
      }));
      return;
    }
    setMutationState({
      isSaving: true,
      isDeleting: false,
      error: null,
      note: null,
      success: null,
    });
    try {
      const payload = await updateTrainerKnowledgeDocument({
        accessToken,
        documentId: selectedDocument.id,
        title: normalizedTitle,
        rawText: normalizedRawText,
        documentType: selectedDocument.document_type || 'text',
        fileUrl: selectedDocument.file_url || null,
        metadata: selectedDocument.metadata || {},
      });
      const updatedDocument = payload?.document || {
        ...selectedDocument,
        title: normalizedTitle,
        raw_text: normalizedRawText,
      };
      const extractionFallbackReason = payload?.extraction?.fallback_reason;
      setSelectedDocument(updatedDocument);
      setDocuments((current) => current.map((document) => (
        document?.id === updatedDocument?.id ? updatedDocument : document
      )));
      setIsEditing(false);
      setMutationState({
        isSaving: false,
        isDeleting: false,
        error: null,
        note: isExtractionSoftNote(extractionFallbackReason)
          ? 'Rule extraction is still processing. You can retry later.'
          : null,
        success: 'Saved changes.',
      });
      onKnowledgeMutated?.();
    } catch (nextError) {
      setMutationState({
        isSaving: false,
        isDeleting: false,
        error: nextError?.message || 'Unable to save document changes.',
        note: null,
        success: null,
      });
    }
  };

  const handleDeleteDocument = async () => {
    if (!selectedDocument?.id || !accessToken || mutationState.isDeleting) {
      return;
    }
    setMutationState({
      isSaving: false,
      isDeleting: true,
      error: null,
      note: null,
      success: null,
    });
    try {
      await deleteTrainerKnowledgeDocument({
        accessToken,
        documentId: selectedDocument.id,
      });
      setDocuments((current) => current.filter((document) => document?.id !== selectedDocument.id));
      setSelectedDocument(null);
      onKnowledgeMutated?.();
    } catch (nextError) {
      setMutationState({
        isSaving: false,
        isDeleting: false,
        error: nextError?.message || 'Unable to delete document.',
        note: null,
        success: null,
      });
    }
  };

  return (
    <SectionShell
      title="Memory Bank"
      subtitle="Compact search and maintenance for saved trainer knowledge."
      onBack={onBack}
      bottomInset={bottomInset}
      rightSlot={(
        <ModeButton
          title={isRefreshing ? 'Refreshing...' : 'Refresh'}
          variant="ghost"
          size="sm"
          onPress={() => loadDocuments({ refresh: true })}
          disabled={isRefreshing || isLoading}
          testID="trainer-system-memory-bank-refresh"
        />
      )}
    >
      <SystemSearchBar
        value={query}
        onChangeText={setQuery}
        placeholder="Search memory bank"
        testID="trainer-system-memory-bank-search"
      />

      <SystemSectionCard>
        <SystemSectionHeader title="Saved Knowledge" />
        {isLoading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={theme.colors.brand.progressCore} />
            <ModeText variant="bodySm" tone="secondary">Loading memory bank...</ModeText>
          </View>
        ) : null}
        {!isLoading && error ? (
          <ModeText variant="bodySm" tone="error">{error}</ModeText>
        ) : null}
        {!isLoading && !error && filteredDocuments.length === 0 ? (
          <EmptyListState
            title="No knowledge documents found"
            detail="Save methodology or quick captures to populate the memory bank."
          />
        ) : null}
        {!isLoading && !error && filteredDocuments.length > 0 ? filteredDocuments.map((document, index) => (
          <SystemNavRow
            key={document?.id || `${document?.title || 'document'}-${index}`}
            icon="file-text"
            title={document?.title || 'Untitled document'}
            subtitle={`${document?.document_type || 'text'} · ${formatSavedDate(document?.created_at)}`}
            onPress={() => openDocument(document)}
            testID={`trainer-system-memory-bank-doc-${document?.id || index}`}
          />
        )) : null}
      </SystemSectionCard>

      <SystemActionSheet
        visible={Boolean(selectedDocument)}
        onClose={() => setSelectedDocument(null)}
        testID="trainer-system-memory-bank-sheet"
      >
        {selectedDocument ? (
          <View style={styles.sheetContent}>
            <ModeText variant="label" tone="tertiary">Memory Bank Item</ModeText>
            {!isEditing ? (
              <>
                <ModeText variant="bodySm" style={styles.sheetTitle}>{selectedDocument.title || 'Untitled document'}</ModeText>
                <ModeText variant="caption" tone="tertiary">
                  {selectedDocument.document_type || 'text'} · {formatSavedDate(selectedDocument.created_at)}
                </ModeText>
                <ModeText variant="bodySm" tone="secondary">
                  {selectedDocument.raw_text || 'No content available for this document.'}
                </ModeText>
              </>
            ) : (
              <>
                <ModeInput
                  value={draftTitle}
                  onChangeText={setDraftTitle}
                  placeholder="Document title"
                  testID="trainer-system-memory-bank-title-input"
                />
                <ModeInput
                  value={draftRawText}
                  onChangeText={setDraftRawText}
                  placeholder="Document content"
                  multiline
                  style={styles.multilineInput}
                  testID="trainer-system-memory-bank-raw-input"
                />
              </>
            )}
            {mutationState.error ? (
              <ModeText variant="caption" tone="error">{mutationState.error}</ModeText>
            ) : null}
            {mutationState.note ? (
              <ModeText variant="caption" tone="secondary">{mutationState.note}</ModeText>
            ) : null}
            {mutationState.success ? (
              <ModeText variant="caption" tone="success">{mutationState.success}</ModeText>
            ) : null}
            {!isEditing ? (
              <View style={styles.buttonStack}>
                <ModeButton
                  title="Edit document"
                  variant="secondary"
                  onPress={() => setIsEditing(true)}
                  testID="trainer-system-memory-bank-edit"
                />
                <ModeButton
                  title={mutationState.isDeleting ? 'Deleting...' : 'Delete document'}
                  variant="destructive"
                  onPress={handleDeleteDocument}
                  disabled={mutationState.isDeleting}
                  testID="trainer-system-memory-bank-delete"
                />
              </View>
            ) : (
              <View style={styles.buttonStack}>
                <ModeButton
                  title={mutationState.isSaving ? 'Saving...' : 'Save changes'}
                  onPress={handleSaveDocument}
                  disabled={mutationState.isSaving}
                  testID="trainer-system-memory-bank-save"
                />
                <ModeButton
                  title="Cancel"
                  variant="ghost"
                  onPress={() => {
                    setIsEditing(false);
                    setDraftTitle(String(selectedDocument?.title || ''));
                    setDraftRawText(String(selectedDocument?.raw_text || ''));
                    setMutationState((current) => ({
                      ...current,
                      error: null,
                    }));
                  }}
                  disabled={mutationState.isSaving}
                  testID="trainer-system-memory-bank-cancel"
                />
              </View>
            )}
          </View>
        ) : null}
      </SystemActionSheet>
    </SectionShell>
  );
}

function KnowledgeMethodologyRulesScreen({
  accessToken,
  bottomInset,
  onBack,
  onKnowledgeMutated,
}) {
  const [title, setTitle] = useState('');
  const [rawText, setRawText] = useState('');
  const [feedback, setFeedback] = useState({ error: null, note: null, success: null });
  const [isSaving, setIsSaving] = useState(false);
  const [rules, setRules] = useState([]);
  const [isLoadingRules, setIsLoadingRules] = useState(true);
  const [rulesError, setRulesError] = useState(null);
  const [selectedRule, setSelectedRule] = useState(null);
  const [editingRuleCategory, setEditingRuleCategory] = useState('');
  const [editingRuleText, setEditingRuleText] = useState('');
  const [isMutatingRule, setIsMutatingRule] = useState(false);
  const [ruleMutationError, setRuleMutationError] = useState(null);

  const loadRules = useCallback(async () => {
    if (!accessToken || !TRAINER_AGENT_LAB_ENABLED) {
      setRules([]);
      setIsLoadingRules(false);
      return;
    }
    setIsLoadingRules(true);
    setRulesError(null);
    try {
      const payload = await listTrainerRules({ accessToken });
      setRules(Array.isArray(payload) ? payload : []);
    } catch (error) {
      setRulesError(error?.message || 'Unable to load extracted rules.');
    } finally {
      setIsLoadingRules(false);
    }
  }, [accessToken]);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  const visibleRules = useMemo(
    () => rules.filter((rule) => !rule?.is_archived),
    [rules],
  );

  const handleSaveMethodology = async () => {
    const normalizedTitle = title.trim();
    const normalizedRawText = rawText.trim();
    if (!normalizedTitle) {
      setFeedback({ error: 'Add a title before saving.', note: null, success: null });
      return;
    }
    if (!normalizedRawText) {
      setFeedback({ error: 'Add coaching content before saving.', note: null, success: null });
      return;
    }
    if (!accessToken || isSaving) {
      return;
    }
    setIsSaving(true);
    setFeedback({ error: null, note: null, success: null });
    try {
      const payload = TRAINER_AGENT_LAB_ENABLED
        ? await saveTrainerKnowledgeDocumentWithFallback({
          accessToken,
          title: normalizedTitle,
          rawText: normalizedRawText,
          metadata: { source: 'agent_lab_long_form' },
        })
        : await createTrainerKnowledgeDocument({
          accessToken,
          title: normalizedTitle,
          rawText: normalizedRawText,
          metadata: { source: 'agent_lab_long_form' },
        });
      const createdCount = payload?.extraction?.rules_created;
      const extractionFallbackReason = payload?.extraction?.fallback_reason;
      setFeedback({
        error: null,
        note: isExtractionSoftNote(extractionFallbackReason)
          ? 'Rule extraction is still processing. You can retry later.'
          : null,
        success: typeof createdCount === 'number'
          ? `Saved and extracted ${createdCount} coaching rule${createdCount === 1 ? '' : 's'}.`
          : 'Saved. Your methodology is available in the memory bank.',
      });
      setTitle('');
      setRawText('');
      await loadRules();
      onKnowledgeMutated?.();
    } catch (error) {
      setFeedback({
        error: error?.message || 'Unable to save trainer knowledge.',
        note: null,
        success: null,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const openRule = (rule) => {
    setSelectedRule(rule);
    setEditingRuleCategory(rule?.category || 'general_coaching');
    setEditingRuleText(rule?.rule_text || '');
    setRuleMutationError(null);
  };

  const handleSaveRule = async () => {
    if (!selectedRule?.id || !accessToken || isMutatingRule) {
      return;
    }
    const normalizedCategory = editingRuleCategory.trim();
    const normalizedText = editingRuleText.trim();
    if (!normalizedCategory) {
      setRuleMutationError('Category cannot be empty.');
      return;
    }
    if (!normalizedText) {
      setRuleMutationError('Rule text cannot be empty.');
      return;
    }
    setIsMutatingRule(true);
    setRuleMutationError(null);
    try {
      await updateTrainerRule({
        accessToken,
        ruleId: selectedRule.id,
        category: normalizedCategory,
        ruleText: normalizedText,
      });
      await loadRules();
      setSelectedRule(null);
      onKnowledgeMutated?.();
    } catch (error) {
      setRuleMutationError(error?.message || 'Unable to update rule.');
    } finally {
      setIsMutatingRule(false);
    }
  };

  const handleArchiveRule = async () => {
    if (!selectedRule?.id || !accessToken || isMutatingRule) {
      return;
    }
    setIsMutatingRule(true);
    setRuleMutationError(null);
    try {
      await archiveTrainerRule({
        accessToken,
        ruleId: selectedRule.id,
      });
      await loadRules();
      setSelectedRule(null);
      onKnowledgeMutated?.();
    } catch (error) {
      setRuleMutationError(error?.message || 'Unable to archive rule.');
    } finally {
      setIsMutatingRule(false);
    }
  };

  return (
    <SectionShell
      title="Methodology / Rules"
      subtitle="Long-form methodology entry plus compact rule maintenance."
      onBack={onBack}
      bottomInset={bottomInset}
      rightSlot={(
        <ModeButton
          title={isLoadingRules ? 'Loading...' : 'Refresh'}
          variant="ghost"
          size="sm"
          onPress={loadRules}
          disabled={isLoadingRules}
          testID="trainer-system-rules-refresh"
        />
      )}
    >
      <ModeCard variant="surface">
        <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>Methodology</ModeText>
        <ModeText variant="bodySm" tone="secondary">
          Paste progression logic, nutrition philosophy, deload rules, communication style, and constraints.
        </ModeText>
        <ModeInput
          value={title}
          onChangeText={setTitle}
          placeholder="Document title"
          testID="trainer-system-methodology-title-input"
        />
        <ModeInput
          value={rawText}
          onChangeText={setRawText}
          placeholder="Paste your methodology here..."
          multiline
          style={styles.multilineInput}
          testID="trainer-system-methodology-raw-input"
        />
        {feedback.error ? (
          <ModeText variant="caption" tone="error">{feedback.error}</ModeText>
        ) : null}
        {feedback.note ? (
          <ModeText variant="caption" tone="secondary">{feedback.note}</ModeText>
        ) : null}
        {feedback.success ? (
          <ModeText variant="caption" tone="success">{feedback.success}</ModeText>
        ) : null}
        <ModeButton
          title={isSaving ? 'Saving...' : 'Save methodology'}
          onPress={handleSaveMethodology}
          disabled={isSaving}
          testID="trainer-system-methodology-save"
        />
      </ModeCard>

      <SystemSectionCard>
        <SystemSectionHeader title="Extracted Rules" />
        {isLoadingRules ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={theme.colors.brand.progressCore} />
            <ModeText variant="bodySm" tone="secondary">Loading extracted rules...</ModeText>
          </View>
        ) : null}
        {!isLoadingRules && rulesError ? (
          <ModeText variant="bodySm" tone="error">{rulesError}</ModeText>
        ) : null}
        {!isLoadingRules && !rulesError && visibleRules.length === 0 ? (
          <EmptyListState
            title="No extracted rules yet"
            detail="Save methodology or quick captures to generate coaching rules."
          />
        ) : null}
        {!isLoadingRules && !rulesError && visibleRules.length > 0 ? visibleRules.map((rule) => (
          <SystemNavRow
            key={rule.id}
            icon="sliders"
            title={rule.rule_text || 'Untitled rule'}
            subtitle={`${formatRuleCategory(rule.category)}${typeof rule.confidence === 'number' ? ` · ${(rule.confidence * 100).toFixed(0)}% confidence` : ''}`}
            badge={rule.current_version ? `v${rule.current_version}` : null}
            onPress={() => openRule(rule)}
            testID={`trainer-system-rule-${rule.id}`}
          />
        )) : null}
      </SystemSectionCard>

      <SystemActionSheet
        visible={Boolean(selectedRule)}
        onClose={() => setSelectedRule(null)}
        testID="trainer-system-rule-sheet"
      >
        {selectedRule ? (
          <View style={styles.sheetContent}>
            <ModeText variant="label" tone="tertiary">Rule Detail</ModeText>
            <ModeInput
              value={editingRuleCategory}
              onChangeText={setEditingRuleCategory}
              placeholder="Rule category"
              testID="trainer-system-rule-category-input"
            />
            <ModeInput
              value={editingRuleText}
              onChangeText={setEditingRuleText}
              placeholder="Rule text"
              multiline
              style={styles.ruleEditInput}
              testID="trainer-system-rule-text-input"
            />
            {ruleMutationError ? (
              <ModeText variant="caption" tone="error">{ruleMutationError}</ModeText>
            ) : null}
            <View style={styles.buttonStack}>
              <ModeButton
                title={isMutatingRule ? 'Saving...' : 'Save rule'}
                onPress={handleSaveRule}
                disabled={isMutatingRule}
                testID="trainer-system-rule-save"
              />
              <ModeButton
                title={isMutatingRule ? 'Archiving...' : 'Archive rule'}
                variant="ghost"
                onPress={handleArchiveRule}
                disabled={isMutatingRule}
                testID="trainer-system-rule-archive"
              />
            </View>
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
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const loadClients = useCallback(async ({ refresh = false } = {}) => {
    if (!accessToken) {
      setPayload({ items: [], count: 0 });
      setIsLoading(false);
      return;
    }
    if (refresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
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
      if (refresh) {
        setIsRefreshing(false);
      } else {
        setIsLoading(false);
      }
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
        <ModeButton
          title={isRefreshing ? 'Refreshing...' : 'Manage'}
          variant="ghost"
          size="sm"
          onPress={onOpenClientManagement}
          testID="trainer-system-clients-manage"
        />
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
            detail="Create an invite code or check trainer assignments."
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
  const [clientsPayload, setClientsPayload] = useState({ items: [], count: 0 });
  const [invitePayload, setInvitePayload] = useState({ items: [], count: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedClient, setSelectedClient] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [clientMutationState, setClientMutationState] = useState({
    isSaving: false,
    isRemoving: false,
    error: null,
  });
  const [inviteStatus, setInviteStatus] = useState({
    isCreating: false,
    isDeactivating: null,
    error: null,
    success: null,
  });

  const loadData = useCallback(async () => {
    if (!accessToken) {
      setClientsPayload({ items: [], count: 0 });
      setInvitePayload({ items: [], count: 0 });
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const [clientsResponse, inviteResponse] = await Promise.all([
        listTrainerClients({ accessToken, query, limit: 100, offset: 0 }),
        listTrainerInviteCodes({ accessToken }),
      ]);
      setClientsPayload(normalizeListPayload(clientsResponse));
      setInvitePayload(normalizeListPayload(inviteResponse));
    } catch (nextError) {
      setError(nextError?.message || 'Unable to load client management data.');
    } finally {
      setIsLoading(false);
    }
  }, [accessToken, query]);

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

  const handleCreateInvite = async () => {
    if (!accessToken || inviteStatus.isCreating) {
      return;
    }
    setInviteStatus({ isCreating: true, isDeactivating: null, error: null, success: null });
    try {
      const payload = await createTrainerInviteCode({
        accessToken,
        code: generateInviteCode(),
        metadata: { source: 'system_hub' },
      });
      setInvitePayload((current) => ({
        count: current.count + 1,
        items: [payload, ...current.items],
      }));
      setInviteStatus({
        isCreating: false,
        isDeactivating: null,
        error: null,
        success: `Invite code ${payload?.code || 'created'} is ready to share.`,
      });
      onClientsMutated?.();
    } catch (error) {
      setInviteStatus({
        isCreating: false,
        isDeactivating: null,
        error: error?.message || 'Unable to create invite code.',
        success: null,
      });
    }
  };

  const handleDeactivateInvite = async (inviteId) => {
    if (!accessToken || !inviteId) {
      return;
    }
    setInviteStatus({ isCreating: false, isDeactivating: inviteId, error: null, success: null });
    try {
      const payload = await deactivateTrainerInviteCode({ accessToken, inviteId });
      setInvitePayload((current) => ({
        ...current,
        items: current.items.map((invite) => (
          invite.id === inviteId ? { ...invite, ...payload } : invite
        )),
      }));
      setInviteStatus({ isCreating: false, isDeactivating: null, error: null, success: 'Invite code deactivated.' });
    } catch (error) {
      setInviteStatus({
        isCreating: false,
        isDeactivating: null,
        error: error?.message || 'Unable to deactivate invite code.',
        success: null,
      });
    }
  };

  return (
    <SectionShell
      title="Client Management"
      subtitle="Rename, unassign, and create invite codes without leaving the System tab."
      onBack={onBack}
      bottomInset={bottomInset}
    >
      <ModeCard variant="hero">
        <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>Add Client</ModeText>
        <ModeText variant="bodySm" tone="secondary">
          Generate invite codes for new clients. Existing codes stay visible until you deactivate them.
        </ModeText>
        <ModeButton
          title={inviteStatus.isCreating ? 'Creating invite...' : 'Create invite code'}
          variant="secondary"
          onPress={handleCreateInvite}
          disabled={inviteStatus.isCreating}
          testID="trainer-system-client-management-create-invite"
        />
        {inviteStatus.error ? (
          <ModeText variant="caption" tone="error">{inviteStatus.error}</ModeText>
        ) : null}
        {inviteStatus.success ? (
          <ModeText variant="caption" tone="success">{inviteStatus.success}</ModeText>
        ) : null}
      </ModeCard>

      <SystemSearchBar
        value={query}
        onChangeText={setQuery}
        placeholder="Search clients"
        testID="trainer-system-client-management-search"
      />

      <SystemSectionCard>
        <SystemSectionHeader title="Invite Codes" />
        {invitePayload.items.length === 0 ? (
          <EmptyListState
            title="No invite codes yet"
            detail="Create one above to add clients into your trainer workspace."
          />
        ) : invitePayload.items.map((invite) => (
          <View key={invite.id} style={styles.managementRow}>
            <View style={styles.managementCopy}>
              <ModeText variant="bodySm">{invite.code || 'Invite code'}</ModeText>
              <ModeText variant="caption" tone="secondary">
                {invite.is_active === false ? 'Inactive' : 'Active'}
                {invite.expires_at ? ` · expires ${formatExceptionDate(String(invite.expires_at).slice(0, 10))}` : ''}
              </ModeText>
            </View>
            <ModeButton
              title={inviteStatus.isDeactivating === invite.id ? 'Deactivating...' : 'Deactivate'}
              variant="ghost"
              size="sm"
              onPress={() => handleDeactivateInvite(invite.id)}
              disabled={invite.is_active === false || inviteStatus.isDeactivating === invite.id}
              testID={`trainer-system-invite-deactivate-${invite.id}`}
            />
          </View>
        ))}
      </SystemSectionCard>

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
            detail="Invite a client or adjust search filters."
          />
        ) : null}
        {!isLoading && !error && clientsPayload.items.length > 0 ? clientsPayload.items.map((client) => (
          <SystemNavRow
            key={client.client_id || client.id}
            icon="user"
            title={client.client_name || 'Unnamed client'}
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

function ClientDetailManagementScreen({
  accessToken,
  bottomInset,
  onBack,
  clientId,
}) {
  const [detail, setDetail] = useState(null);
  const [aiContext, setAiContext] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadClient = useCallback(async () => {
    if (!accessToken || !clientId) {
      setDetail(null);
      setAiContext(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const [detailPayload, aiContextPayload] = await Promise.all([
        getTrainerClientDetail({ accessToken, clientId }),
        getTrainerClientAIContext({ accessToken, clientId }),
      ]);
      setDetail(detailPayload);
      setAiContext(aiContextPayload);
    } catch (nextError) {
      setError(nextError?.message || 'Unable to load client detail.');
    } finally {
      setIsLoading(false);
    }
  }, [accessToken, clientId]);

  useEffect(() => {
    loadClient();
  }, [loadClient]);

  const clientName = detail?.client?.client_name || 'Client';

  return (
    <SectionShell
      title={clientName}
      subtitle="Client detail management"
      onBack={onBack}
      bottomInset={bottomInset}
      rightSlot={(
        <ModeButton
          title={isLoading ? 'Loading...' : 'Refresh'}
          variant="ghost"
          size="sm"
          onPress={loadClient}
          disabled={isLoading}
          testID="trainer-system-client-detail-refresh"
        />
      )}
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

          <SystemSectionCard>
            <SystemSectionHeader title="AI Context" />
            <DetailRow label="Memories" value={valueOrFallback(detail?.memory_counts?.total, '0')} />
            <DetailRow label="AI-usable" value={valueOrFallback(detail?.memory_counts?.ai_usable, '0')} />
            <DetailRow label="Internal only" value={valueOrFallback(detail?.memory_counts?.internal_only, '0')} />
            <ModeText variant="bodySm" tone="secondary">
              {valueOrFallback(aiContext?.context_preview_text, 'No context preview available.')}
            </ModeText>
          </SystemSectionCard>
        </>
      ) : null}
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
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const [draftResponse, outputResponse, qaResponse] = await Promise.all([
        getTrainerCoachQueue({ accessToken, limit: 50 }),
        getTrainerReviewOutputs({ accessToken, status: 'open', limit: 50, offset: 0 }),
        requestTrainerReviewQueue({ accessToken }),
      ]);
      setDraftPayload(normalizeListPayload(draftResponse));
      setOutputsPayload(normalizeListPayload(outputResponse));
      setQaItems(Array.isArray(qaResponse) ? qaResponse : []);
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
    return qaItems;
  }, [draftPayload.items, outputsPayload.items, qaItems, segment]);

  const openItem = (item) => {
    setSelectedItem(item);
    setEditedText(
      String(
        item?.reviewed_output_text
        || item?.edited_output_text
        || item?.output_text
        || item?.model_draft_answer
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
          autoApplyDeltas: true,
        });
      } else if (action === 'approve') {
        await approveTrainerReviewOutput({
          accessToken,
          outputId: selectedItem.id,
          editedOutputText: editedText,
          editedOutputJson: null,
          responseTags: [],
          autoApplyDeltas: true,
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
        ]}
      />

      <SystemSectionCard>
        <SystemSectionHeader
          title={segment === REVIEW_SEGMENT.DRAFTS
            ? 'Draft Queue'
            : segment === REVIEW_SEGMENT.OUTPUTS
              ? 'Outputs / Corrections'
              : 'Low-Confidence QA'}
        />
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
              : item?.user_question || 'Low-confidence output';
          const subtitle = segment === REVIEW_SEGMENT.DRAFTS
            ? `${item?.client_name || 'Client'} · ${item?.summary || item?.action_type || 'Open draft'}`
            : segment === REVIEW_SEGMENT.OUTPUTS
              ? `${item?.source_type || 'chat'}${item?.client_id ? ` · ${item.client_id}` : ''}`
              : `Confidence ${typeof item?.confidence_score === 'number' ? `${(item.confidence_score * 100).toFixed(0)}%` : 'unknown'} · ${item?.status || 'open'}`;
          const badge = segment === REVIEW_SEGMENT.DRAFTS
            ? item?.priority_tier || null
            : segment === REVIEW_SEGMENT.OUTPUTS
              ? item?.review_status || null
              : typeof item?.confidence_score === 'number'
                ? `${Math.round(item.confidence_score * 100)}%`
                : null;
          return (
            <SystemNavRow
              key={key}
              icon={segment === REVIEW_SEGMENT.QA ? 'alert-circle' : 'check-square'}
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
            <ModeInput
              value={editedText}
              onChangeText={setEditedText}
              placeholder="Review and edit the response text"
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
        <SystemSectionHeader title="Diagnostics" />
        <DetailRow label="Environment" value={environment} />
        <DetailRow label="Version" value={appVersion} />
        <DetailRow label="API Base" value={valueOrFallback(debugInfo.resolvedApiBaseUrl)} />
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
  const [isRefreshingHub, setIsRefreshingHub] = useState(false);
  const [trainerSettings, setTrainerSettings] = useState(null);
  const [isLoadingTrainerSettings, setIsLoadingTrainerSettings] = useState(false);

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
    setIsRefreshingHub(true);
    try {
      const [knowledgeResponse, clientsResponse, draftResponse, outputResponse, qaResponse] = await Promise.all([
        listTrainerKnowledgeDocuments({ accessToken }),
        listTrainerClients({ accessToken, limit: 1, offset: 0 }),
        getTrainerCoachQueue({ accessToken, limit: 50 }),
        getTrainerReviewOutputs({ accessToken, status: 'open', limit: 50, offset: 0 }),
        requestTrainerReviewQueue({ accessToken }),
      ]);
      const clientsCount = normalizeListPayload(clientsResponse).count;
      const knowledgeCount = Array.isArray(knowledgeResponse) ? knowledgeResponse.length : 0;
      const draftCount = normalizeListPayload(draftResponse).count;
      const outputCount = normalizeListPayload(outputResponse).count;
      const qaCount = Array.isArray(qaResponse) ? qaResponse.length : 0;
      setHubCounts({
        clients: clientsCount,
        knowledge: knowledgeCount,
        review: draftCount + outputCount + qaCount,
      });
    } catch (_error) {
      setHubCounts((current) => current);
    } finally {
      setIsRefreshingHub(false);
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

  useEffect(() => {
    refreshHubCounts();
    loadTrainerSettings();
  }, [refreshHubCounts, loadTrainerSettings]);

  const handleTrainerSettingsSaved = useCallback((payload) => {
    setTrainerSettings(payload);
  }, []);

  const commonViewProps = {
    accessToken,
    bottomInset,
  };

  if (currentView.key === SYSTEM_VIEW.COACH_PROFILE) {
    return (
      <CoachProfileScreen
        bottomInset={bottomInset}
        onBack={popView}
        trainerName={trainerName}
        onboardingState={onboardingState}
        onOpenTrainerCoach={onOpenTrainerCoach}
      />
    );
  }

  if (currentView.key === SYSTEM_VIEW.COACH_SETTINGS) {
    return (
      <CoachSettingsScreen
        bottomInset={bottomInset}
        onBack={popView}
        onboardingState={onboardingState}
        onNavigate={pushView}
      />
    );
  }

  if (currentView.key === SYSTEM_VIEW.COACH_RETRAIN_REVIEW) {
    return (
      <CoachRetrainReviewScreen
        bottomInset={bottomInset}
        onBack={popView}
        onboardingState={onboardingState}
        onOpenTrainerCoach={onOpenTrainerCoach}
      />
    );
  }

  if (currentView.key === SYSTEM_VIEW.KNOWLEDGE_MEMORY_BANK) {
    return (
      <KnowledgeMemoryBankScreen
        {...commonViewProps}
        onBack={popView}
        onKnowledgeMutated={refreshHubCounts}
      />
    );
  }

  if (currentView.key === SYSTEM_VIEW.KNOWLEDGE_METHODOLOGY_RULES) {
    return (
      <KnowledgeMethodologyRulesScreen
        {...commonViewProps}
        onBack={popView}
        onKnowledgeMutated={refreshHubCounts}
      />
    );
  }

  if (currentView.key === SYSTEM_VIEW.KNOWLEDGE_QUICK_CAPTURES) {
    return (
      <KnowledgeQuickCapturesScreen
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
      isRefreshing={isRefreshingHub}
      onRefresh={() => {
        refreshHubCounts();
        loadTrainerSettings();
      }}
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
  quickCaptureInput: {
    minHeight: 104,
  },
  multilineInput: {
    minHeight: 150,
  },
  ruleEditInput: {
    minHeight: 110,
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
  managementCopy: {
    flex: 1,
    gap: 4,
  },
});

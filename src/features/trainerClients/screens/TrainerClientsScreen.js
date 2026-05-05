import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Feather from '@expo/vector-icons/Feather';

import {
  GlassSurface,
  GlassToggle,
  HeaderBar,
  ModeButton,
  ModeCard,
  ModeChip,
  ModeInput,
  ModeText,
  PremiumClientCard,
  ProgressBar,
  SafeScreen,
} from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import DraftReviewStructuredCard from '../../draftReview/components/DraftReviewStructuredCard';
import {
  buildRegenerationLaunchContext,
  rebuildJSON,
  transformPlan,
} from '../../draftReview/domain/draftReviewModel';
import {
  approveTrainerCoachQueueItem,
  getTrainerCoachQueue,
  rejectTrainerCoachQueueItem,
} from '../../trainerCoach/services/trainerCoachApi';
import {
  archiveTrainerClientMemory,
  createTrainerClientScheduleException,
  createTrainerClientMemory,
  deleteTrainerClientScheduleException,
  getTrainerClientSchedulePreferences,
  getTrainerClientAIContext,
  getTrainerClientDetail,
  getTrainerCommandCenter,
  listTrainerClientMemory,
  patchTrainerClientSchedulePreferences,
  updateTrainerClientMemory,
} from '../services/trainerHomeApi';
import {
  formatIsoWeekdaySummary,
  ISO_WEEKDAY_OPTIONS,
  resolveClientScheduledForFilter,
  toggleIsoWeekday,
} from '../utils/scheduleResolver';
import {
  DRAFT_REVIEW_DAILY_GOAL,
  loadDraftReviewTracker,
  recordDraftReviewAction,
} from '../storage/draftReviewTrackerStorage';
import {
  loadTrainerClientsSummaryVisibility,
  saveTrainerClientsSummaryVisibility,
} from '../storage/trainerClientsSummaryVisibilityStorage';
import {
  FilterBar,
  FilterBottomSheet,
} from '../components/CommandCenterFilters';
import { BREATHING_TRANSITIONS_ENABLED } from '../../../config/featureFlags';
import { BREATHING_CONTEXT, BreathingTransitionOverlay } from '../../shared/loading';

const VIEW_MODE = {
  COMMAND_CENTER: 'command_center',
  CLIENT_DETAIL: 'client_detail',
  CLIENT_SETUP: 'client_setup',
};

const CLIENT_SETUP_NOTES_MEMORY_KEY = 'client_setup_notes_v1';

const PRIORITY_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'critical', label: 'Critical' },
  { key: 'high', label: 'High' },
  { key: 'watch', label: 'Watchlist' },
];

const DAY_FILTERS = [
  { key: 'today', label: 'Today', offsetDays: 0 },
  { key: 'tomorrow', label: 'Tomorrow', offsetDays: 1 },
];

const SESSION_FILTERS = [
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'all', label: 'All Clients' },
];

const DRAFT_QUEUE_FETCH_LIMIT = 100;

const DRAFT_REVIEW_ACTION_TYPE = {
  APPROVE: 'approve',
  REJECT: 'reject',
};

const DEFAULT_DAY_FILTER = 'today';
const DEFAULT_SESSION_FILTER = 'scheduled';
const DEFAULT_PRIORITY_FILTER = 'all';

const FILTER_SHEET = {
  DAY: 'day',
  SESSION: 'session',
  PRIORITY: 'priority',
};

function deriveSummaryStatus({
  trainerOnboardingCompleted,
  draftQueueCount,
  highPriorityClients,
  criticalPriorityClients,
}) {
  if (!trainerOnboardingCompleted) {
    return {
      title: 'Calibration incomplete',
      subtitle: 'Finish coach setup so drafts and rules stay in your voice.',
    };
  }

  if (draftQueueCount > 0) {
    return {
      title: `${draftQueueCount} drafts pending review`,
      subtitle: 'Resolve pending drafts to keep client delivery on track.',
    };
  }

  const clientsNeedAttention = Math.max(
    Number(criticalPriorityClients) || 0,
    Number(highPriorityClients) || 0,
  );
  if (clientsNeedAttention > 0) {
    return {
      title: `${clientsNeedAttention} clients need attention`,
      subtitle: 'High-risk clients should get a proactive touchpoint today.',
    };
  }

  return {
    title: 'All clients are on track',
    subtitle: 'No blockers are open. You can run a proactive sweep.',
  };
}

function buildDraftReviewIdempotencyKey(prefix = 'clients-draft-review') {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 12)}`;
}

function resolveDraftQueueSelection(items, preferredOutputId, { allowNullSelection = false } = {}) {
  const queueItems = Array.isArray(items) ? items : [];
  if (queueItems.length === 0) {
    return null;
  }
  if (allowNullSelection && preferredOutputId === null) {
    return null;
  }
  if (typeof preferredOutputId === 'string' && preferredOutputId.trim()) {
    const match = queueItems.find((item) => item.output_id === preferredOutputId);
    if (match?.output_id) {
      return match.output_id;
    }
  }
  return queueItems[0].output_id;
}

function buildNextDraftReviewState(items, currentOutputId) {
  const queueItems = Array.isArray(items) ? items : [];
  if (queueItems.length === 0) {
    return {
      optimisticItems: [],
      nextOutputId: null,
      allowNullSelection: true,
    };
  }

  const currentIndex = queueItems.findIndex((item) => item.output_id === currentOutputId);
  const resolvedIndex = currentIndex >= 0 ? currentIndex : 0;

  const optimisticItems = queueItems.filter((item) => item.output_id !== currentOutputId);
  if (optimisticItems.length === 0) {
    return {
      optimisticItems: [],
      nextOutputId: null,
      allowNullSelection: true,
    };
  }
  const nextOutputId = optimisticItems[resolvedIndex]?.output_id
    || optimisticItems[optimisticItems.length - 1]?.output_id
    || null;
  return {
    optimisticItems,
    nextOutputId,
    allowNullSelection: false,
  };
}

function formatSessionWindow(startAt, endAt) {
  if (!startAt && !endAt) {
    return 'No session scheduled';
  }
  const start = startAt ? new Date(startAt) : null;
  const end = endAt ? new Date(endAt) : null;
  const startLabel = start && !Number.isNaN(start.getTime())
    ? start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : 'Start TBD';
  const endLabel = end && !Number.isNaN(end.getTime())
    ? end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : 'End TBD';
  return `${startLabel} - ${endLabel}`;
}

function formatAvgScore(value) {
  if (typeof value !== 'number') {
    return 'N/A';
  }
  return `${value.toFixed(1)}/25`;
}

function formatQuestionAverage(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 'N/A';
  }
  return `${value.toFixed(1)}/5`;
}

function normalizeSignalStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'low' || normalized === 'watch' || normalized === 'steady' || normalized === 'no_data') {
    return normalized;
  }
  return 'no_data';
}

function getQuestionSummaries(source) {
  const summaries = Array.isArray(source?.question_summaries)
    ? source.question_summaries
    : [];
  return summaries
    .filter((summary) => summary && typeof summary === 'object')
    .map((summary) => ({
      ...summary,
      key: String(summary.key || '').trim(),
      label: String(summary.label || summary.key || 'Signal').trim(),
      status: normalizeSignalStatus(summary.status),
      daily_responses: Array.isArray(summary.daily_responses) ? summary.daily_responses : [],
    }))
    .filter((summary) => summary.key);
}

function hasQuestionSummariesField(source) {
  return Boolean(source && Object.prototype.hasOwnProperty.call(source, 'question_summaries'));
}

function hasQuestionSignalResponses(questionSummaries) {
  if (!Array.isArray(questionSummaries) || questionSummaries.length === 0) {
    return false;
  }
  return questionSummaries.some((summary) => {
    if ((Number(summary?.responses_7d) || 0) > 0) {
      return true;
    }
    return (Array.isArray(summary?.daily_responses) ? summary.daily_responses : [])
      .some((entry) => typeof entry?.score === 'number');
  });
}

function getSignalTone(status) {
  if (status === 'low') {
    return 'error';
  }
  if (status === 'watch') {
    return 'warning';
  }
  if (status === 'steady') {
    return 'success';
  }
  return 'secondary';
}

function getSignalChipStyle(status) {
  if (status === 'low') {
    return {
      backgroundColor: theme.colors.feedback.errorBg,
      borderColor: theme.colors.feedback.errorBorder,
    };
  }
  if (status === 'watch') {
    return {
      backgroundColor: theme.colors.feedback.warningBg,
      borderColor: theme.colors.feedback.warningBorder,
    };
  }
  if (status === 'steady') {
    return {
      backgroundColor: theme.colors.feedback.successBg,
      borderColor: theme.colors.feedback.successBorder,
    };
  }
  return {
    backgroundColor: theme.colors.surface.elevated,
    borderColor: theme.colors.glass.borderSoft,
  };
}

function formatQuestionStatusLabel(status) {
  if (status === 'no_data') {
    return 'No data';
  }
  return toTitleCase(status);
}

function formatLatestSignal(summary) {
  if (typeof summary?.latest_score !== 'number') {
    return 'Latest: N/A';
  }
  return `Latest: ${summary.latest_score}/5 on ${formatCompactDateLabel(summary.latest_date)}`;
}

function buildSignalCoachingPrompt(summary) {
  const status = normalizeSignalStatus(summary?.status);
  if (status !== 'low' && status !== 'watch') {
    return null;
  }
  const average = formatQuestionAverage(summary?.average_7d);
  if (summary?.key === 'sleep') {
    return `Sleep is ${status} at ${average}. Ask about bedtime consistency, wake-ups, caffeine, and whether today's work should stay controlled.`;
  }
  if (summary?.key === 'motivation') {
    return `Motivation is ${status} at ${average}. Identify the main friction point, then set one small action they can complete today.`;
  }
  if (summary?.key === 'stress') {
    return `Stress readiness is ${status} at ${average}. Ask what has felt heaviest and pair training with one simple downshift cue.`;
  }
  if (summary?.key === 'soreness') {
    return `Body feel is ${status} at ${average}. Ask where soreness is showing up and adjust load or range before progressing.`;
  }
  if (summary?.key === 'nutrition') {
    return `Nutrition is ${status} at ${average}. Confirm the easiest protein, hydration, or meal-prep anchor for the next 24 hours.`;
  }
  return `${summary?.label || 'This signal'} is ${status} at ${average}. Ask one specific follow-up before loading the session.`;
}

function formatResponseScore(score) {
  return typeof score === 'number' ? `${score}` : 'N/A';
}

function normalizePriorityTier(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'critical' || normalized === 'high' || normalized === 'medium') {
    return normalized;
  }
  return 'low';
}

function resolveConcernBadge(client) {
  const priorityTier = normalizePriorityTier(client?.priority_tier);
  if (priorityTier === 'critical') {
    return {
      tier: 'critical',
      label: 'Needs Attention',
      backgroundColor: theme.colors.feedback.errorBg,
      borderColor: theme.colors.feedback.errorBorder,
      tone: 'error',
    };
  }
  if (priorityTier === 'high') {
    return {
      tier: 'high',
      label: 'At Risk',
      backgroundColor: theme.colors.feedback.warningBg,
      borderColor: theme.colors.feedback.warningBorder,
      tone: 'warning',
    };
  }
  if (priorityTier === 'medium') {
    return {
      tier: 'medium',
      label: 'Follow-Up',
      backgroundColor: theme.colors.surface.elevated,
      borderColor: theme.colors.border.default,
      tone: 'secondary',
    };
  }
  return null;
}

function normalizeBriefClause(input) {
  const normalized = String(input || '')
    .replace(/^[\s•\-–]+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.;:,]+$/, '');
  if (!normalized) {
    return '';
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function splitCoachingPromptIntoBullets(point) {
  const normalized = String(point || '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return [];
  }
  const delimitersNormalized = normalized
    .replace(/\bthen\b/gi, '|')
    .replace(/[;:]+/g, '|')
    .replace(/\.(?=\s+[A-Z])/g, '|')
    .replace(/,\s+(?=(?:and\s+)?(?:today|this week|confirm|review|check|acknowledge|celebrate|open|start|ask|lock|set|mention)\b)/gi, '|')
    .replace(/\s+and\s+(?=today['’]s\b)/gi, '|');
  const parsedClauses = delimitersNormalized
    .split('|')
    .map(normalizeBriefClause)
    .filter((clause) => clause.length >= 8);
  const fallbackClauses = parsedClauses.length >= 2
    ? parsedClauses
    : normalized
      .split(',')
      .map(normalizeBriefClause)
      .filter((clause) => clause.length >= 10);
  const uniqueClauses = [];
  const seen = new Set();
  fallbackClauses.forEach((clause) => {
    const key = clause.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      uniqueClauses.push(clause);
    }
  });
  return uniqueClauses.slice(0, 4);
}

function buildFallbackBriefBullets({ client, isScheduledForSelectedDay }) {
  const weekSummary = client?.week_summary || {};
  const checkinsCompleted = Number(weekSummary.checkins_completed_7d) || 0;
  const hasTodayCheckin = Boolean(weekSummary.checkins_completed_today);
  return [
    'Acknowledge one specific win from the week',
    checkinsCompleted > 0
      ? `${checkinsCompleted} check-ins completed this week`
      : 'No check-ins completed this week yet',
    hasTodayCheckin
      ? "Today's check-in is already done"
      : "Confirm today's readiness before coaching",
    isScheduledForSelectedDay
      ? 'Confirm the top blocker before coaching'
      : 'Confirm the top blocker and next-session plan',
  ];
}

function buildReadinessNarrative(client, isScheduledForSelectedDay) {
  const weekSummary = client?.week_summary || {};
  const averageScore = typeof weekSummary.avg_score_7d === 'number'
    ? weekSummary.avg_score_7d
    : null;
  const workoutsCompleted = Number(weekSummary.workouts_completed_7d) || 0;
  if (averageScore !== null && averageScore >= 20) {
    return `Readiness looks solid at an average score of ${averageScore.toFixed(1)}/25 with strong consistency this week. Movement quality and recovery appear stable, so consider a small progression if the client reports low friction today.`;
  }
  if (averageScore !== null && averageScore < 15) {
    return `Readiness is trending low at ${averageScore.toFixed(1)}/25 this week. Keep intensity controlled, reinforce recovery basics, and confirm today's biggest friction point before progressing load.`;
  }
  if (!isScheduledForSelectedDay) {
    return 'No session is scheduled today. Use the recent check-in trend to set one accountability action before the next session.';
  }
  if (workoutsCompleted <= 1) {
    return 'Workout completion has been light this week. Open with one confidence-building win, then align on the smallest next action they can complete within 24 hours.';
  }
  return 'Readiness context is steady. Confirm the top blocker, reinforce one win, and set one specific coaching target for this session.';
}

function buildCoachingBrief(client, isScheduledForSelectedDay) {
  const talkingPoints = Array.isArray(client?.talking_points?.points)
    ? client.talking_points.points
    : [];
  const leadPoint = talkingPoints.find((point) => typeof point === 'string' && point.trim());
  const parsedBullets = splitCoachingPromptIntoBullets(leadPoint);
  const bullets = parsedBullets.length >= 2
    ? parsedBullets
    : buildFallbackBriefBullets({ client, isScheduledForSelectedDay });
  const secondaryPoint = talkingPoints.find((point, index) => (
    index > 0
    && typeof point === 'string'
    && point.trim()
  ));
  return {
    bullets: bullets.slice(0, 4),
    narrative: secondaryPoint ? secondaryPoint.trim() : buildReadinessNarrative(client, isScheduledForSelectedDay),
  };
}

function formatModeSuffix(value) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return '';
  }
  return ` (${normalized})`;
}

function parseTags(inputValue) {
  return String(inputValue || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function toTitleCase(input) {
  return String(input || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function parseDateForLabel(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map((part) => Number(part));
    return new Date(year, month - 1, day);
  }
  return new Date(value);
}

function formatDateLabel(value) {
  if (!value) {
    return 'No recent check-in';
  }
  const parsed = parseDateForLabel(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'No recent check-in';
  }
  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function formatCompactDateLabel(value) {
  if (!value) {
    return '';
  }
  const parsed = parseDateForLabel(value);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function buildMemoryMetaLine(record) {
  const tags = Array.isArray(record?.tags) ? record.tags : [];
  const parts = [];
  if (tags.length > 0) {
    parts.push(tags.join(', '));
  }
  const updatedLabel = formatCompactDateLabel(record?.updated_at || record?.created_at);
  if (updatedLabel) {
    parts.push(`Updated ${updatedLabel}`);
  }
  return parts.join(' • ');
}

function toLocalIsoDate(value) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildPlannerDateByOffset(offsetDays = 0) {
  const next = new Date();
  next.setHours(0, 0, 0, 0);
  next.setDate(next.getDate() + offsetDays);
  return toLocalIsoDate(next);
}

function formatPlannerDateLabel(value) {
  if (!value) {
    return '';
  }
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  return parsed.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function buildSignalWindowLabel(anchorDate) {
  if (!anchorDate) {
    return '';
  }
  const endDate = parseDateForLabel(anchorDate);
  if (Number.isNaN(endDate.getTime())) {
    return '';
  }
  const startDate = new Date(endDate);
  startDate.setDate(endDate.getDate() - 6);
  const startLabel = startDate.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
  const endLabel = endDate.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
  return `Window: ${startLabel}-${endLabel}`;
}

function buildClientScheduleDraft(client) {
  return {
    recurringWeekdays: Array.isArray(client?.recurring_weekdays) ? client.recurring_weekdays : [],
    preferredMeetingLocation: String(client?.preferred_meeting_location || ''),
    autoUseTrainerDefaultLocation: client?.auto_use_trainer_default_location !== false,
    exceptionType: client?.selected_date_exception_type || null,
    exceptionLocationOverride: String(client?.selected_date_meeting_location_override || ''),
  };
}

function buildDetailScheduleDraft(schedulePreferences) {
  return {
    recurringWeekdays: Array.isArray(schedulePreferences?.recurring_weekdays)
      ? schedulePreferences.recurring_weekdays
      : [],
    preferredMeetingLocation: String(schedulePreferences?.preferred_meeting_location || ''),
    autoUseTrainerDefaultLocation: schedulePreferences?.auto_use_trainer_default_location !== false,
    exceptionType: schedulePreferences?.selected_date_exception_type || null,
    exceptionLocationOverride: String(schedulePreferences?.selected_date_meeting_location_override || ''),
  };
}

function buildTrainerRouteError(error, fallbackMessage) {
  const message = String(error?.message || fallbackMessage);
  const status = typeof error?.status === 'number' ? error.status : null;
  const requestPath = typeof error?.request_path === 'string'
    ? error.request_path
    : (typeof error?.path === 'string' ? error.path : null);
  const apiBase = typeof error?.api_base_url === 'string'
    ? error.api_base_url
    : (typeof error?.resolved_api_base_url === 'string' ? error.resolved_api_base_url : null);
  const isStaleBackendRoute = (
    Boolean(error?.is_missing_trainer_route)
    || (
      status === 404
      && message.trim().toLowerCase() === 'not found'
      && (
        (typeof requestPath === 'string' && requestPath.startsWith('/api/v1/trainer-home/command-center'))
        || (typeof requestPath === 'string' && requestPath.startsWith('/api/v1/trainer-clients/'))
        || (typeof requestPath === 'string' && requestPath.startsWith('/api/v1/trainer-coach/'))
      )
    )
  );

  return {
    message,
    status,
    requestPath,
    apiBase,
    isStaleBackendRoute,
  };
}

function normalizeScheduleDraft(draft) {
  return {
    recurringWeekdays: Array.isArray(draft?.recurringWeekdays)
      ? [...new Set(draft.recurringWeekdays.map((value) => Number(value)).filter((value) => value >= 1 && value <= 7))].sort((a, b) => a - b)
      : [],
    preferredMeetingLocation: String(draft?.preferredMeetingLocation || '').trim(),
    autoUseTrainerDefaultLocation: draft?.autoUseTrainerDefaultLocation !== false,
  };
}

function areScheduleDraftsEqual(a, b) {
  const left = normalizeScheduleDraft(a);
  const right = normalizeScheduleDraft(b);
  if (left.autoUseTrainerDefaultLocation !== right.autoUseTrainerDefaultLocation) {
    return false;
  }
  if (left.preferredMeetingLocation !== right.preferredMeetingLocation) {
    return false;
  }
  if (left.recurringWeekdays.length !== right.recurringWeekdays.length) {
    return false;
  }
  return left.recurringWeekdays.every((value, index) => value === right.recurringWeekdays[index]);
}

function hasConfiguredTemplate(scheduleDraft) {
  const normalized = normalizeScheduleDraft(scheduleDraft);
  return (
    normalized.recurringWeekdays.length > 0
    || Boolean(normalized.preferredMeetingLocation)
    || normalized.autoUseTrainerDefaultLocation === false
  );
}

function buildScheduleUiState(scheduleDraft) {
  return {
    isTemplateExpanded: !hasConfiguredTemplate(scheduleDraft),
    activeQuickRow: null,
    isActionsSheetOpen: false,
  };
}

function formatOverrideSummary({
  exceptionType,
  plannerDayLabel,
  isScheduledForSelectedDay,
}) {
  if (exceptionType === 'skip') {
    return `Override • ${plannerDayLabel} skipped`;
  }
  if (exceptionType === 'add') {
    return `Override • ${plannerDayLabel} added`;
  }
  return isScheduledForSelectedDay ? 'Status • Scheduled today' : 'Status • No session today';
}

function toRecordTimestamp(value) {
  const parsed = new Date(value || '');
  const timestamp = parsed.getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function findClientSetupNotesRecord(records) {
  const rows = (Array.isArray(records) ? records : [])
    .filter((record) => (
      !record?.is_archived
      && record?.memory_type === 'note'
      && record?.memory_key === CLIENT_SETUP_NOTES_MEMORY_KEY
    ))
    .sort((left, right) => (
      toRecordTimestamp(right?.updated_at || right?.created_at)
      - toRecordTimestamp(left?.updated_at || left?.created_at)
    ));
  return rows[0] || null;
}

function normalizeSetupOverrideMode(exceptionType) {
  if (exceptionType === 'skip' || exceptionType === 'add') {
    return exceptionType;
  }
  return 'none';
}

function setupOverrideLabel(mode, plannerDayLabel) {
  if (mode === 'skip') {
    return `${plannerDayLabel} skipped`;
  }
  if (mode === 'add') {
    return `${plannerDayLabel} added`;
  }
  return `Use recurring ${plannerDayLabel.toLowerCase()} plan`;
}

function CommandCenterActionsSheet({
  visible,
  onClose,
  plannerDayLabel,
  onEditSessionSetup,
  onEditClientNotes,
  onOpenClientDetail,
  onSkip,
  onAdd,
  onClear,
  isSaving = false,
  hasOverride = false,
  testIDPrefix,
}) {
  if (!visible) {
    return null;
  }
  return (
    <Modal
      visible
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.scheduleSheetRoot}>
        <Pressable style={styles.scheduleSheetBackdrop} onPress={onClose} />
        <GlassSurface
          state="elevated"
          radius="xl"
          padding={0}
          style={styles.scheduleSheet}
          contentStyle={styles.scheduleSheetContent}
          fillColor={theme.colors.surface.overlay}
          borderColor={theme.colors.glass.borderStrong}
          highlight
        >
          <View style={styles.scheduleSheetGrabber} />
          <ModeText variant="h3" style={styles.scheduleSheetTitle}>Client actions</ModeText>
          <ModeButton
            testID={`${testIDPrefix}-action-edit-setup`}
            title="Edit Session Setup"
            size="sm"
            variant="secondary"
            disabled={isSaving}
            onPress={onEditSessionSetup}
          />
          <ModeButton
            testID={`${testIDPrefix}-action-edit-notes`}
            title="Edit Client Notes"
            size="sm"
            variant="ghost"
            disabled={isSaving}
            onPress={onEditClientNotes}
          />
          <ModeButton
            testID={`${testIDPrefix}-action-open-detail`}
            title="Open Client Detail"
            size="sm"
            variant="ghost"
            disabled={isSaving}
            onPress={onOpenClientDetail}
          />
          <ModeButton
            testID={`${testIDPrefix}-action-skip`}
            title={`Mark ${plannerDayLabel} skip`}
            size="sm"
            variant="secondary"
            disabled={isSaving}
            onPress={onSkip}
          />
          <ModeButton
            testID={`${testIDPrefix}-action-add`}
            title={`Add ${plannerDayLabel} session`}
            size="sm"
            variant="ghost"
            disabled={isSaving}
            onPress={onAdd}
          />
          <ModeButton
            testID={`${testIDPrefix}-action-clear`}
            title="Clear today override"
            size="sm"
            variant="ghost"
            disabled={isSaving || !hasOverride}
            onPress={onClear}
          />
          <ModeButton
            title="Close"
            size="sm"
            variant="ghost"
            disabled={isSaving}
            onPress={onClose}
          />
        </GlassSurface>
      </View>
    </Modal>
  );
}

function QuestionSignalChipRow({
  questionSummaries,
  testIDPrefix,
}) {
  if (!Array.isArray(questionSummaries) || questionSummaries.length === 0) {
    return null;
  }

  return (
    <View testID={`${testIDPrefix}-question-signals`} style={styles.questionSignalsBlock}>
      <ModeText variant="caption" tone="tertiary" style={styles.questionSignalsLabel}>
        7-day signals
      </ModeText>
      <View style={styles.questionSignalChipRow}>
        {questionSummaries.map((summary) => {
          const status = normalizeSignalStatus(summary.status);
          return (
            <View
              key={`${testIDPrefix}-${summary.key}`}
              testID={`${testIDPrefix}-signal-${summary.key}`}
              style={[styles.questionSignalChip, getSignalChipStyle(status)]}
            >
              <ModeText variant="caption" tone={getSignalTone(status)} style={styles.questionSignalLabel}>
                {summary.label}
              </ModeText>
              <ModeText variant="caption" tone={getSignalTone(status)} style={styles.questionSignalValue}>
                {formatQuestionAverage(summary.average_7d)}
              </ModeText>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function QuestionSignalDetailSection({
  questionSummaries,
  isMissingFromBackend,
  windowLabel,
}) {
  const safeSummaries = Array.isArray(questionSummaries) ? questionSummaries : [];
  const hasResponses = hasQuestionSignalResponses(safeSummaries);
  let fallbackMessage = null;
  if (isMissingFromBackend) {
    fallbackMessage = 'Signal analysis not returned by backend.';
  } else if (!hasResponses) {
    fallbackMessage = 'No check-ins in selected 7-day window.';
  }

  return (
    <ModeCard variant="surface" style={styles.questionSignalDetailCard}>
      <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>
        7-Day Check-In Signals
      </ModeText>
      {windowLabel ? (
        <ModeText
          testID="trainer-client-detail-signal-window"
          variant="caption"
          tone="secondary"
          style={styles.questionSignalWindowLabel}
        >
          {windowLabel}
        </ModeText>
      ) : null}
      {fallbackMessage ? (
        <ModeText
          testID="trainer-client-detail-signal-fallback"
          variant="bodySm"
          tone="secondary"
        >
          {fallbackMessage}
        </ModeText>
      ) : (
        <View style={styles.questionSignalDetailList}>
          {safeSummaries.map((summary) => {
            const status = normalizeSignalStatus(summary.status);
            const coachingPrompt = buildSignalCoachingPrompt(summary);
            return (
              <View
                key={`detail-signal-${summary.key}`}
                testID={`trainer-client-detail-signal-${summary.key}`}
                style={styles.questionSignalDetailRow}
              >
                <View style={styles.questionSignalDetailHeader}>
                  <View style={styles.questionSignalDetailTitle}>
                    <ModeText variant="bodySm" style={styles.questionSignalDetailName}>
                      {summary.label}
                    </ModeText>
                    <ModeText variant="caption" tone="secondary">
                      {summary.responses_7d || 0}/7 responses • {summary.low_days_7d || 0} low days
                    </ModeText>
                  </View>
                  <View style={[styles.questionSignalStatusBadge, getSignalChipStyle(status)]}>
                    <ModeText variant="caption" tone={getSignalTone(status)} style={styles.questionSignalStatusText}>
                      {formatQuestionAverage(summary.average_7d)} • {formatQuestionStatusLabel(status)}
                    </ModeText>
                  </View>
                </View>

                <ModeText variant="caption" tone="secondary">
                  {formatLatestSignal(summary)}
                </ModeText>

                <View style={styles.questionSignalDayRow}>
                  {summary.daily_responses.map((entry) => (
                    <View
                      key={`${summary.key}-${entry.date}`}
                      style={styles.questionSignalDayPill}
                    >
                      <ModeText variant="caption" tone="tertiary" style={styles.questionSignalDayDate}>
                        {formatCompactDateLabel(entry.date)}
                      </ModeText>
                      <ModeText variant="caption" style={styles.questionSignalDayScore}>
                        {formatResponseScore(entry.score)}
                      </ModeText>
                    </View>
                  ))}
                </View>

                {coachingPrompt ? (
                  <ModeText
                    testID={`trainer-client-detail-signal-${summary.key}-prompt`}
                    variant="bodySm"
                    tone="secondary"
                    style={styles.questionSignalPrompt}
                  >
                    {coachingPrompt}
                  </ModeText>
                ) : null}
              </View>
            );
          })}
        </View>
      )}
    </ModeCard>
  );
}

function ClientSummaryBlock({
  title,
  concernBadge,
  briefBullets,
  questionSummaries,
  sessionLine,
  metricLine,
  locationLine,
  readinessNarrative,
  onOpenActions,
  testIDPrefix,
}) {
  return (
    <View>
      <View style={styles.clientHeaderRow}>
        <ModeText variant="h3" style={styles.clientName}>{title}</ModeText>
        <View style={styles.headerActions}>
          {concernBadge ? (
            <View
              testID={`${testIDPrefix}-concern-badge`}
              style={[
                styles.priorityBadge,
                {
                  backgroundColor: concernBadge.backgroundColor,
                  borderColor: concernBadge.borderColor,
                },
              ]}
            >
              <ModeText variant="caption" tone={concernBadge.tone}>{concernBadge.label}</ModeText>
            </View>
          ) : null}
          <Pressable
            testID={`${testIDPrefix}-actions-open`}
            onPress={onOpenActions}
            style={({ pressed }) => [styles.iconActionButton, pressed && styles.iconActionButtonPressed]}
            accessibilityRole="button"
            accessibilityLabel="Open client actions"
          >
            <Feather name="more-horizontal" size={16} color={theme.colors.text.secondary} />
          </Pressable>
        </View>
      </View>

      <View style={styles.summaryTextBlock} testID={`${testIDPrefix}-summary`}>
        <View testID={`${testIDPrefix}-coaching-brief`} style={styles.coachingBriefBlock}>
          <ModeText testID={`${testIDPrefix}-brief-title`} variant="label" tone="tertiary">
            Suggested opening
          </ModeText>
          <View style={styles.coachingBriefList}>
            {briefBullets.map((bullet, index) => (
              <ModeText
                key={`${testIDPrefix}-brief-${index + 1}`}
                testID={`${testIDPrefix}-brief-bullet-${index + 1}`}
                variant="bodySm"
                style={styles.coachingBriefBullet}
              >
                • {bullet}
              </ModeText>
            ))}
          </View>
        </View>

        <QuestionSignalChipRow
          questionSummaries={questionSummaries}
          testIDPrefix={testIDPrefix}
        />

        <View testID={`${testIDPrefix}-supporting-signals`} style={styles.supportingSignalBlock}>
          <ModeText variant="caption" tone="secondary" style={styles.supportingMetaLine}>{sessionLine}</ModeText>
          <ModeText variant="caption" tone="tertiary" style={styles.supportingMetaLine}>{metricLine}</ModeText>
          <ModeText variant="caption" tone="tertiary" style={styles.supportingMetaLine}>{locationLine}</ModeText>
        </View>

        <View style={styles.readinessNarrativeBlock}>
          <ModeText
            testID={`${testIDPrefix}-readiness-narrative`}
            variant="bodySm"
            tone="secondary"
            style={styles.readinessNarrativeText}
          >
            {readinessNarrative}
          </ModeText>
        </View>
      </View>
    </View>
  );
}

function ClientTodayCard({
  client,
  plannerDayLabel,
  isActionsOpen,
  isMutatingActions,
  onOpenActions,
  onCloseActions,
  onEditSessionSetup,
  onEditClientNotes,
  onApplySkip,
  onApplyAdd,
  onClearOverride,
  onOpenClientDetail,
}) {
  const clientId = client?.client_id || 'unknown';
  const isScheduledForSelectedDay = typeof client?.scheduled_today === 'boolean'
    ? client.scheduled_today
    : resolveClientScheduledForFilter(client, null);
  const concernBadge = resolveConcernBadge(client);
  const coachingBrief = buildCoachingBrief(client, isScheduledForSelectedDay);
  const questionSummaries = getQuestionSummaries(client?.week_summary);
  const sessionWindow = formatSessionWindow(client?.session_start_at, client?.session_end_at);
  const sessionLine = isScheduledForSelectedDay
    ? `Next Session: ${plannerDayLabel}${sessionWindow !== 'No session scheduled' ? ` • ${sessionWindow}` : ''}`
    : `Next Session: No ${plannerDayLabel.toLowerCase()} session scheduled`;
  const metricLine = `${client?.week_summary?.checkins_completed_7d || 0} check-ins • avg ${formatAvgScore(client?.week_summary?.avg_score_7d)}${formatModeSuffix(client?.week_summary?.avg_mode_7d)} • ${client?.week_summary?.workouts_completed_7d || 0} workouts`;
  const locationLine = `Location • ${client?.meeting_location || 'Not set'}`;
  const hasOverride = Boolean(client?.selected_date_exception_type);
  const testIDPrefix = `trainer-client-card-${clientId}`;

  return (
    <PremiumClientCard
      emphasis={concernBadge?.tier === 'critical' ? 'focus' : 'default'}
      style={styles.clientOperationalCard}
    >
      <ClientSummaryBlock
        title={client?.client_name || 'Client'}
        concernBadge={concernBadge}
        briefBullets={coachingBrief.bullets}
        questionSummaries={questionSummaries}
        sessionLine={sessionLine}
        metricLine={metricLine}
        locationLine={locationLine}
        readinessNarrative={coachingBrief.narrative}
        onOpenActions={onOpenActions}
        testIDPrefix={testIDPrefix}
      />

      <ModeButton
        title="Open Client Detail"
        variant="ghost"
        size="sm"
        onPress={onOpenClientDetail}
      />

      <CommandCenterActionsSheet
        visible={Boolean(isActionsOpen)}
        onClose={onCloseActions}
        plannerDayLabel={plannerDayLabel}
        onEditSessionSetup={onEditSessionSetup}
        onEditClientNotes={onEditClientNotes}
        onOpenClientDetail={onOpenClientDetail}
        onSkip={onApplySkip}
        onAdd={onApplyAdd}
        onClear={onClearOverride}
        isSaving={Boolean(isMutatingActions)}
        hasOverride={hasOverride}
        testIDPrefix={testIDPrefix}
      />
    </PremiumClientCard>
  );
}

function ClientSetupScreen({
  clientName,
  plannerDayLabel,
  setupDraft,
  setupFocusSection,
  setupError,
  setupSuccess,
  isLoading,
  isSaving,
  onBack,
  onPatchDraft,
  onToggleRecurringWeekday,
  onSave,
}) {
  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.colors.accent.primary} />
        <ModeText variant="bodySm" tone="secondary">Loading client setup...</ModeText>
      </View>
    );
  }
  if (!setupDraft) {
    return (
      <ModeCard variant="surface">
        <ModeText variant="bodySm" tone="error">Unable to load client setup.</ModeText>
        <ModeButton title="Back" variant="secondary" onPress={onBack} style={styles.actionButton} />
      </ModeCard>
    );
  }
  return (
    <>
      <ModeButton
        title="Back"
        variant="ghost"
        onPress={onBack}
      />

      <ModeCard variant="hero" testID="trainer-client-setup-screen">
        <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>Client Setup</ModeText>
        <ModeText variant="bodySm">{clientName}</ModeText>
        <ModeText variant="caption" tone="secondary">
          {setupFocusSection === 'notes' ? 'Focused section: Notes' : 'Focused section: Schedule'}
        </ModeText>
      </ModeCard>

      <ModeCard variant="surface">
        <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>Schedule</ModeText>
        <ModeText variant="bodySm" tone="secondary">Recurring days seen</ModeText>
        <View style={styles.weekdayChipRowCompact}>
          {ISO_WEEKDAY_OPTIONS.map((option) => (
            <ModeChip
              key={`client-setup-weekday-${option.value}`}
              testID={`trainer-client-setup-weekday-${option.value}`}
              label={option.label}
              selected={Array.isArray(setupDraft.recurringWeekdays) && setupDraft.recurringWeekdays.includes(option.value)}
              onPress={() => onToggleRecurringWeekday(option.value)}
            />
          ))}
        </View>
      </ModeCard>

      <ModeCard variant="surface">
        <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>This Week Override</ModeText>
        <View style={styles.inlineChipRow}>
          <ModeChip
            testID="trainer-client-setup-override-none"
            label="Use recurring"
            selected={setupDraft.overrideMode === 'none'}
            onPress={() => onPatchDraft({ overrideMode: 'none' })}
          />
          <ModeChip
            testID="trainer-client-setup-override-skip"
            label="Skip"
            selected={setupDraft.overrideMode === 'skip'}
            onPress={() => onPatchDraft({ overrideMode: 'skip' })}
          />
          <ModeChip
            testID="trainer-client-setup-override-add"
            label="Add"
            selected={setupDraft.overrideMode === 'add'}
            onPress={() => onPatchDraft({ overrideMode: 'add' })}
          />
        </View>
        <ModeText variant="caption" tone="secondary">
          {setupOverrideLabel(setupDraft.overrideMode, plannerDayLabel)}
        </ModeText>
        {setupDraft.overrideMode === 'add' ? (
          <ModeInput
            testID="trainer-client-setup-override-location-input"
            value={setupDraft.overrideLocation || ''}
            onChangeText={(value) => onPatchDraft({ overrideLocation: value })}
            placeholder={`${plannerDayLabel} override location (optional)`}
          />
        ) : null}
      </ModeCard>

      <ModeCard variant="surface">
        <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>Location</ModeText>
        <ModeText variant="caption" tone="tertiary">
          Trainer default: {setupDraft.trainerDefaultLocation || 'Not set'}
        </ModeText>
        <ModeText variant="caption" tone="tertiary">
          Auto-fill trainer default: {setupDraft.trainerAutoFillLocation ? 'On' : 'Off'}
        </ModeText>
        <View style={styles.inlineChipRow}>
          <ModeChip
            testID="trainer-client-setup-use-default-on"
            label="Use trainer default"
            selected={Boolean(setupDraft.autoUseTrainerDefaultLocation)}
            onPress={() => onPatchDraft({ autoUseTrainerDefaultLocation: true })}
          />
          <ModeChip
            testID="trainer-client-setup-use-default-off"
            label="Custom location"
            selected={!setupDraft.autoUseTrainerDefaultLocation}
            onPress={() => onPatchDraft({ autoUseTrainerDefaultLocation: false })}
          />
        </View>
        <ModeInput
          testID="trainer-client-setup-client-location-input"
          value={setupDraft.preferredMeetingLocation || ''}
          onChangeText={(value) => onPatchDraft({ preferredMeetingLocation: value })}
          placeholder="Client default location"
        />
      </ModeCard>

      <ModeCard variant="surface">
        <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>Notes</ModeText>
        <ModeText variant="caption" tone="secondary">
          Save durable coaching memory for goals, injuries, food preferences, and accountability themes.
        </ModeText>
        <ModeInput
          testID="trainer-client-setup-notes-input"
          value={setupDraft.notesText || ''}
          onChangeText={(value) => onPatchDraft({ notesText: value })}
          placeholder="Write coaching setup notes..."
          multiline
          style={styles.memoryInput}
        />
      </ModeCard>

      {setupError ? (
        <ModeCard variant="surface">
          <ModeText variant="bodySm" tone="error">{setupError}</ModeText>
        </ModeCard>
      ) : null}
      {setupSuccess ? (
        <ModeCard variant="surface">
          <ModeText variant="bodySm" tone="secondary">{setupSuccess}</ModeText>
        </ModeCard>
      ) : null}

      <ModeButton
        testID="trainer-client-setup-save"
        title={isSaving ? 'Saving...' : 'Save Setup'}
        variant="primary"
        disabled={isSaving}
        onPress={onSave}
      />
    </>
  );
}

function MemoryEditSheet({
  visible,
  record,
  isSaving,
  text,
  tagsText,
  aiReadable,
  tagsVisible,
  onChangeText,
  onChangeTagsText,
  onToggleAiReadable,
  onShowTags,
  onSave,
  onClose,
}) {
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (!visible) {
      setKeyboardHeight(0);
      return undefined;
    }
    const openEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const closeEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const openSubscription = Keyboard.addListener(openEvent, (event) => {
      const nextHeight = Number(event?.endCoordinates?.height) || 0;
      setKeyboardHeight(Math.max(0, nextHeight));
    });
    const closeSubscription = Keyboard.addListener(closeEvent, () => {
      setKeyboardHeight(0);
    });
    return () => {
      openSubscription.remove();
      closeSubscription.remove();
    };
  }, [visible]);

  if (!visible || !record) {
    return null;
  }

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View testID="trainer-client-memory-edit-sheet" style={styles.memoryEditSheetRoot}>
        <Pressable
          testID="trainer-client-memory-edit-sheet-backdrop"
          style={styles.memoryEditSheetBackdrop}
          onPress={onClose}
        />
        <GlassSurface
          state="elevated"
          radius="xl"
          padding={0}
          style={[
            styles.memoryEditSheet,
            keyboardHeight > 0 && { marginBottom: keyboardHeight + theme.spacing[1] },
          ]}
          contentStyle={styles.memoryEditSheetContent}
          fillColor={theme.colors.surface.overlay}
          borderColor={theme.colors.glass.borderStrong}
          highlight
        >
          <View style={styles.memoryEditSheetGrabber} />
          <View style={styles.memoryEditSheetHeader}>
            <View style={styles.memoryEditSheetCopy}>
              <ModeText variant="label" tone="tertiary" style={styles.memoryEditSheetLabel}>Edit Memory</ModeText>
              <ModeText variant="caption" tone="secondary">{toTitleCase(record.memory_type || 'note')}</ModeText>
            </View>
            <Pressable
              testID="trainer-client-memory-edit-close"
              style={({ pressed }) => [styles.memoryRowIconButton, pressed && styles.memoryRowIconButtonPressed]}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close memory editor"
              hitSlop={6}
            >
              <Feather name="x" size={16} color={theme.colors.text.secondary} />
            </Pressable>
          </View>
          <ModeInput
            testID="trainer-client-memory-edit-input"
            value={text}
            onChangeText={onChangeText}
            placeholder="Update memory note..."
          />
          <View style={styles.memoryToggleRow}>
            <ModeText variant="bodySm">AI can read this</ModeText>
            <GlassToggle
              testID="trainer-client-memory-edit-ai-toggle"
              value={aiReadable}
              onValueChange={onToggleAiReadable}
              disabled={isSaving}
            />
          </View>
          {tagsVisible ? (
            <ModeInput
              testID="trainer-client-memory-edit-tags-input"
              value={tagsText}
              onChangeText={onChangeTagsText}
              placeholder="Tags (comma separated)"
            />
          ) : (
            <Pressable
              testID="trainer-client-memory-edit-add-tags"
              onPress={onShowTags}
              style={({ pressed }) => [styles.memoryTagsAction, pressed && styles.memoryTagsActionPressed]}
              accessibilityRole="button"
              accessibilityLabel="Add tags"
            >
              <ModeText variant="caption" tone="secondary" style={styles.memoryTagsActionText}>Add tags</ModeText>
            </Pressable>
          )}
          <View style={styles.memoryEditSheetActionRow}>
            <ModeButton
              testID="trainer-client-memory-edit-cancel"
              title="Cancel"
              variant="ghost"
              size="sm"
              disabled={isSaving}
              onPress={onClose}
              style={styles.memoryEditSheetActionButton}
            />
            <ModeButton
              testID="trainer-client-memory-edit-save"
              title={isSaving ? 'Saving...' : 'Save'}
              variant="primary"
              size="sm"
              disabled={isSaving}
              onPress={onSave}
              style={styles.memoryEditSheetActionButton}
            />
          </View>
        </GlassSurface>
      </View>
    </Modal>
  );
}

export default function TrainerClientsScreen({
  accessToken,
  bottomInset = 0,
  onOpenTrainerCoach = null,
}) {
  const insets = useSafeAreaInsets();
  const [viewMode, setViewMode] = useState(VIEW_MODE.COMMAND_CENTER);
  const [dayFilter, setDayFilter] = useState(DEFAULT_DAY_FILTER);
  const [sessionFilter, setSessionFilter] = useState(DEFAULT_SESSION_FILTER);
  const [priorityFilter, setPriorityFilter] = useState(DEFAULT_PRIORITY_FILTER);
  const [activeFilterSheet, setActiveFilterSheet] = useState(null);
  const [commandCenterPayload, setCommandCenterPayload] = useState(null);
  const [isLoadingCommandCenter, setIsLoadingCommandCenter] = useState(true);
  const [hasLoadedCommandCenter, setHasLoadedCommandCenter] = useState(false);
  const [, setIsRefreshingTalkingPoints] = useState(false);
  const [isTopSummaryCollapsed, setIsTopSummaryCollapsed] = useState(false);
  const [commandCenterError, setCommandCenterError] = useState(null);
  const [scheduleBaseByClient, setScheduleBaseByClient] = useState({});
  const [scheduleDraftByClient, setScheduleDraftByClient] = useState({});
  const [, setScheduleTouchedByClient] = useState({});
  const [, setScheduleUiByClient] = useState({});
  const [, setScheduleFeedbackByClient] = useState({});
  const [savingScheduleClientId, setSavingScheduleClientId] = useState(null);
  const [commandCenterActionsClientId, setCommandCenterActionsClientId] = useState(null);

  const [selectedClientId, setSelectedClientId] = useState(null);
  const [detailPayload, setDetailPayload] = useState(null);
  const [memoryRecords, setMemoryRecords] = useState([]);
  const [aiContextPayload, setAiContextPayload] = useState(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState(null);
  const [detailScheduleBase, setDetailScheduleBase] = useState(null);
  const [detailScheduleDraft, setDetailScheduleDraft] = useState(null);
  const [, setDetailScheduleUi] = useState({
    isTemplateExpanded: false,
    activeQuickRow: null,
    isActionsSheetOpen: false,
  });
  const [isSavingDetailSchedule, setIsSavingDetailSchedule] = useState(false);
  const [, setDetailScheduleError] = useState(null);
  const [, setDetailScheduleSuccess] = useState(null);
  const [isDetailContextExpanded, setIsDetailContextExpanded] = useState(false);
  const [setupClientId, setSetupClientId] = useState(null);
  const [setupReturnView, setSetupReturnView] = useState(VIEW_MODE.COMMAND_CENTER);
  const [setupFocusSection, setSetupFocusSection] = useState('schedule');
  const [setupDraft, setSetupDraft] = useState(null);
  const [setupNotesMemoryId, setSetupNotesMemoryId] = useState(null);
  const [setupError, setSetupError] = useState(null);
  const [setupSuccess, setSetupSuccess] = useState(null);
  const [isLoadingSetup, setIsLoadingSetup] = useState(false);
  const [isSavingSetup, setIsSavingSetup] = useState(false);

  const [newMemoryText, setNewMemoryText] = useState('');
  const [newMemoryAiReadable, setNewMemoryAiReadable] = useState(false);
  const [newMemoryTagsText, setNewMemoryTagsText] = useState('');
  const [isNewMemoryTagsVisible, setIsNewMemoryTagsVisible] = useState(false);
  const [isSavingMemory, setIsSavingMemory] = useState(false);
  const [memoryMutationError, setMemoryMutationError] = useState(null);
  const [memoryMutationSuccess, setMemoryMutationSuccess] = useState(null);

  const [editingMemoryId, setEditingMemoryId] = useState(null);
  const [editingText, setEditingText] = useState('');
  const [editingAiReadable, setEditingAiReadable] = useState(false);
  const [editingTagsText, setEditingTagsText] = useState('');
  const [isEditingTagsVisible, setIsEditingTagsVisible] = useState(false);

  const [draftQueueItems, setDraftQueueItems] = useState([]);
  const [isLoadingDraftQueue, setIsLoadingDraftQueue] = useState(true);
  const [draftQueueError, setDraftQueueError] = useState(null);
  const [activeDraftOutputId, setActiveDraftOutputId] = useState(null);
  const [activeDraftModel, setActiveDraftModel] = useState(null);
  const [isMutatingDraftReview, setIsMutatingDraftReview] = useState(false);
  const [draftReviewMutationError, setDraftReviewMutationError] = useState(null);
  const [draftReviewMutationSuccess, setDraftReviewMutationSuccess] = useState(null);

  const [draftReviewTracker, setDraftReviewTracker] = useState({
    date_key: null,
    daily_count: 0,
    lifetime_count: 0,
    pending_sync_events: [],
    updated_at: null,
  });
  const [isLoadingDraftReviewTracker, setIsLoadingDraftReviewTracker] = useState(true);
  const breathingTransitionsEnabled = Boolean(BREATHING_TRANSITIONS_ENABLED);

  const selectedDayConfig = useMemo(
    () => DAY_FILTERS.find((option) => option.key === dayFilter) || DAY_FILTERS[0],
    [dayFilter],
  );
  const selectedSessionConfig = useMemo(
    () => SESSION_FILTERS.find((option) => option.key === sessionFilter) || SESSION_FILTERS[0],
    [sessionFilter],
  );
  const selectedPriorityConfig = useMemo(
    () => PRIORITY_FILTERS.find((option) => option.key === priorityFilter) || PRIORITY_FILTERS[0],
    [priorityFilter],
  );
  const plannerDate = useMemo(
    () => buildPlannerDateByOffset(selectedDayConfig.offsetDays),
    [selectedDayConfig.offsetDays],
  );
  const hasCustomFilters = (
    dayFilter !== DEFAULT_DAY_FILTER
    || sessionFilter !== DEFAULT_SESSION_FILTER
    || priorityFilter !== DEFAULT_PRIORITY_FILTER
  );

  const clientItems = useMemo(() => (
    Array.isArray(commandCenterPayload?.clients)
      ? commandCenterPayload.clients
      : []
  ), [commandCenterPayload?.clients]);

  const selectedClientFromList = useMemo(
    () => clientItems.find((item) => item.client_id === selectedClientId) || null,
    [clientItems, selectedClientId],
  );
  const setupClientFromList = useMemo(
    () => clientItems.find((item) => item.client_id === setupClientId) || null,
    [clientItems, setupClientId],
  );

  const draftReviewTrackerScopeId = useMemo(() => {
    const trainerId = commandCenterPayload?.trainer?.trainer_id;
    if (typeof trainerId === 'string' && trainerId.trim()) {
      return trainerId.trim();
    }
    return 'default';
  }, [commandCenterPayload?.trainer?.trainer_id]);
  const summaryVisibilityTrainerId = useMemo(() => {
    const trainerId = commandCenterPayload?.trainer?.trainer_id;
    if (typeof trainerId === 'string' && trainerId.trim()) {
      return trainerId.trim();
    }
    return null;
  }, [commandCenterPayload?.trainer?.trainer_id]);

  const activeDraft = useMemo(() => {
    if (!Array.isArray(draftQueueItems) || draftQueueItems.length === 0) {
      return null;
    }
    if (typeof activeDraftOutputId === 'string' && activeDraftOutputId.trim()) {
      return draftQueueItems.find((item) => item.output_id === activeDraftOutputId) || null;
    }
    return null;
  }, [activeDraftOutputId, draftQueueItems]);

  const activeDraftPosition = useMemo(() => {
    if (!activeDraft?.output_id) {
      return null;
    }
    const index = draftQueueItems.findIndex((item) => item.output_id === activeDraft.output_id);
    return index >= 0 ? index + 1 : null;
  }, [activeDraft?.output_id, draftQueueItems]);

  const draftQueueCount = Array.isArray(draftQueueItems) ? draftQueueItems.length : 0;
  const shouldShowDraftReviewCard = draftQueueCount > 0 || Boolean(draftQueueError);
  const draftReviewDailyCount = Number(draftReviewTracker?.daily_count) || 0;
  const draftReviewLifetimeCount = Number(draftReviewTracker?.lifetime_count) || 0;
  const draftReviewGoalDenominator = draftQueueCount > 0
    ? Math.min(draftQueueCount, DRAFT_REVIEW_DAILY_GOAL)
    : 0;
  const draftReviewDisplayDailyCount = draftReviewGoalDenominator > 0
    ? Math.min(draftReviewDailyCount, draftReviewGoalDenominator)
    : 0;
  const draftReviewDailyProgress = draftReviewGoalDenominator > 0
    ? Math.max(0, Math.min(1, draftReviewDisplayDailyCount / draftReviewGoalDenominator))
    : 0;

  const visibleClientItems = useMemo(() => {
    const baseItems = sessionFilter === 'scheduled'
      ? clientItems.filter((item) => resolveClientScheduledForFilter(item, plannerDate))
      : clientItems;
    if (priorityFilter === 'all') {
      return baseItems;
    }
    if (priorityFilter === 'critical') {
      return baseItems.filter((item) => item.priority_tier === 'critical');
    }
    if (priorityFilter === 'high') {
      return baseItems.filter((item) => item.priority_tier === 'high');
    }
    if (priorityFilter === 'watch') {
      return baseItems.filter((item) => item.priority_tier === 'medium');
    }
    return baseItems;
  }, [clientItems, plannerDate, priorityFilter, sessionFilter]);

  const editingMemoryRecord = useMemo(() => (
    Array.isArray(memoryRecords)
      ? memoryRecords.find((record) => record?.id === editingMemoryId) || null
      : null
  ), [editingMemoryId, memoryRecords]);

  const loadCommandCenter = useCallback(async ({
    refreshTalkingPoints = false,
    silent = false,
  } = {}) => {
    if (!accessToken) {
      setCommandCenterPayload(null);
      setHasLoadedCommandCenter(false);
      setIsLoadingCommandCenter(false);
      return;
    }
    if (!silent) {
      setIsLoadingCommandCenter(true);
    }
    if (refreshTalkingPoints) {
      setIsRefreshingTalkingPoints(true);
    }
    setCommandCenterError(null);
    try {
      const payload = await getTrainerCommandCenter({
        accessToken,
        date: plannerDate,
        refreshTalkingPoints,
      });
      setCommandCenterPayload(payload);
      setHasLoadedCommandCenter(true);
    } catch (error) {
      setCommandCenterError(buildTrainerRouteError(error, 'Unable to load Command Center.'));
    } finally {
      if (!silent) {
        setIsLoadingCommandCenter(false);
      }
      if (refreshTalkingPoints) {
        setIsRefreshingTalkingPoints(false);
      }
    }
  }, [accessToken, plannerDate]);

  const loadDraftQueue = useCallback(async ({
    silent = false,
    preferredOutputId,
    allowNullSelection = false,
  } = {}) => {
    if (!accessToken) {
      setDraftQueueItems([]);
      setActiveDraftOutputId(null);
      setDraftQueueError(null);
      setIsLoadingDraftQueue(false);
      return [];
    }
    if (!silent) {
      setIsLoadingDraftQueue(true);
    }
    setDraftQueueError(null);
    try {
      const payload = await getTrainerCoachQueue({
        accessToken,
        date: plannerDate,
        limit: DRAFT_QUEUE_FETCH_LIMIT,
      });
      const items = Array.isArray(payload?.items) ? payload.items : [];
      setDraftQueueItems(items);
      setActiveDraftOutputId((previous) => {
        const nextPreferred = typeof preferredOutputId !== 'undefined' ? preferredOutputId : previous;
        return resolveDraftQueueSelection(items, nextPreferred, { allowNullSelection });
      });
      return items;
    } catch (error) {
      setDraftQueueError(buildTrainerRouteError(error, 'Unable to load draft queue.'));
      return [];
    } finally {
      if (!silent) {
        setIsLoadingDraftQueue(false);
      }
    }
  }, [accessToken, plannerDate]);

  const loadDraftReviewTrackerState = useCallback(async () => {
    if (!accessToken) {
      setDraftReviewTracker({
        date_key: null,
        daily_count: 0,
        lifetime_count: 0,
        pending_sync_events: [],
        updated_at: null,
      });
      setIsLoadingDraftReviewTracker(false);
      return;
    }
    setIsLoadingDraftReviewTracker(true);
    try {
      const snapshot = await loadDraftReviewTracker(draftReviewTrackerScopeId);
      setDraftReviewTracker(snapshot);
    } catch (_error) {
      setDraftReviewTracker({
        date_key: null,
        daily_count: 0,
        lifetime_count: 0,
        pending_sync_events: [],
        updated_at: null,
      });
    } finally {
      setIsLoadingDraftReviewTracker(false);
    }
  }, [accessToken, draftReviewTrackerScopeId]);

  const loadClientDetailView = useCallback(async (clientId) => {
    if (!accessToken || !clientId) {
      return;
    }
    setIsLoadingDetail(true);
    setDetailError(null);
    setMemoryMutationError(null);
    setMemoryMutationSuccess(null);
    try {
      const [detail, memory, aiContext] = await Promise.all([
        getTrainerClientDetail({ accessToken, clientId, date: plannerDate }),
        listTrainerClientMemory({ accessToken, clientId }),
        getTrainerClientAIContext({ accessToken, clientId }),
      ]);
      setDetailPayload(detail);
      setMemoryRecords(Array.isArray(memory) ? memory : []);
      setAiContextPayload(aiContext);
    } catch (error) {
      setDetailError(buildTrainerRouteError(error, 'Unable to load client detail.'));
    } finally {
      setIsLoadingDetail(false);
    }
  }, [accessToken, plannerDate]);

  useEffect(() => {
    loadCommandCenter();
  }, [loadCommandCenter]);

  useEffect(() => {
    loadDraftQueue();
  }, [loadDraftQueue]);

  useEffect(() => {
    loadDraftReviewTrackerState();
  }, [loadDraftReviewTrackerState]);

  useEffect(() => {
    let isActive = true;
    if (!summaryVisibilityTrainerId) {
      setIsTopSummaryCollapsed(false);
      return () => {
        isActive = false;
      };
    }
    loadTrainerClientsSummaryVisibility(summaryVisibilityTrainerId)
      .then((snapshot) => {
        if (!isActive) {
          return;
        }
        setIsTopSummaryCollapsed(Boolean(snapshot?.collapsed));
      })
      .catch(() => {
        if (!isActive) {
          return;
        }
        setIsTopSummaryCollapsed(false);
      });
    return () => {
      isActive = false;
    };
  }, [summaryVisibilityTrainerId]);

  useEffect(() => {
    setActiveDraftModel(activeDraft ? transformPlan(activeDraft) : null);
    setDraftReviewMutationError(null);
    // Preserve local edits when queue metadata refreshes for the same output.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDraft?.output_id]);

  useEffect(() => {
    const nextBaseByClient = {};
    clientItems.forEach((item) => {
      const clientId = item?.client_id;
      if (!clientId) {
        return;
      }
      nextBaseByClient[clientId] = buildClientScheduleDraft(item);
    });
    setScheduleBaseByClient(nextBaseByClient);
    setScheduleDraftByClient((previousDraftByClient) => {
      const nextDraftByClient = {};
      Object.keys(nextBaseByClient).forEach((clientId) => {
        const previousDraft = previousDraftByClient[clientId];
        const previousBase = scheduleBaseByClient[clientId];
        const shouldPreserveDraft = (
          previousDraft
          && previousBase
          && !areScheduleDraftsEqual(previousDraft, previousBase)
        );
        nextDraftByClient[clientId] = shouldPreserveDraft
          ? previousDraft
          : nextBaseByClient[clientId];
      });
      return nextDraftByClient;
    });
    setScheduleUiByClient((previousUiByClient) => {
      const nextUiByClient = {};
      Object.keys(nextBaseByClient).forEach((clientId) => {
        if (previousUiByClient[clientId]) {
          nextUiByClient[clientId] = previousUiByClient[clientId];
          return;
        }
        nextUiByClient[clientId] = buildScheduleUiState(nextBaseByClient[clientId]);
      });
      return nextUiByClient;
    });
    setScheduleFeedbackByClient((previousFeedbackByClient) => {
      const nextFeedbackByClient = {};
      Object.keys(nextBaseByClient).forEach((clientId) => {
        if (previousFeedbackByClient[clientId]) {
          nextFeedbackByClient[clientId] = previousFeedbackByClient[clientId];
        }
      });
      return nextFeedbackByClient;
    });
    setScheduleTouchedByClient((previousTouchedByClient) => {
      const nextTouchedByClient = {};
      Object.keys(nextBaseByClient).forEach((clientId) => {
        if (previousTouchedByClient[clientId]) {
          nextTouchedByClient[clientId] = true;
        }
      });
      return nextTouchedByClient;
    });
  // Preserve unsaved per-client edits during command-center refresh.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientItems]);

  useEffect(() => {
    setScheduleFeedbackByClient({});
  }, [dayFilter, sessionFilter]);

  const closeFilterSheet = useCallback(() => {
    setActiveFilterSheet(null);
  }, []);

  const openDayFilterSheet = useCallback(() => {
    setActiveFilterSheet(FILTER_SHEET.DAY);
  }, []);

  const openSessionFilterSheet = useCallback(() => {
    setActiveFilterSheet(FILTER_SHEET.SESSION);
  }, []);

  const openPriorityFilterSheet = useCallback(() => {
    setActiveFilterSheet(FILTER_SHEET.PRIORITY);
  }, []);

  const handleSelectDayFilter = useCallback((nextFilterKey) => {
    setDayFilter(nextFilterKey);
    setActiveFilterSheet(null);
  }, []);

  const handleSelectSessionFilter = useCallback((nextFilterKey) => {
    setSessionFilter(nextFilterKey);
    setActiveFilterSheet(null);
  }, []);

  const handleSelectPriorityFilter = useCallback((nextFilterKey) => {
    setPriorityFilter(nextFilterKey);
    setActiveFilterSheet(null);
  }, []);

  const resetFilters = useCallback(() => {
    setDayFilter(DEFAULT_DAY_FILTER);
    setSessionFilter(DEFAULT_SESSION_FILTER);
    setPriorityFilter(DEFAULT_PRIORITY_FILTER);
    setActiveFilterSheet(null);
  }, []);

  const activeFilterSheetConfig = useMemo(() => {
    if (activeFilterSheet === FILTER_SHEET.DAY) {
      return {
        title: 'Day Window',
        options: DAY_FILTERS,
        selectedKey: dayFilter,
        onSelect: handleSelectDayFilter,
      };
    }
    if (activeFilterSheet === FILTER_SHEET.SESSION) {
      return {
        title: 'Session Scope',
        options: SESSION_FILTERS,
        selectedKey: sessionFilter,
        onSelect: handleSelectSessionFilter,
      };
    }
    if (activeFilterSheet === FILTER_SHEET.PRIORITY) {
      return {
        title: 'Priority',
        options: PRIORITY_FILTERS,
        selectedKey: priorityFilter,
        onSelect: handleSelectPriorityFilter,
      };
    }
    return null;
  }, [
    activeFilterSheet,
    dayFilter,
    handleSelectDayFilter,
    handleSelectPriorityFilter,
    handleSelectSessionFilter,
    priorityFilter,
    sessionFilter,
  ]);

  useEffect(() => {
    const nextSchedulePreferences = detailPayload?.schedule_preferences;
    if (!nextSchedulePreferences) {
      setDetailScheduleBase(null);
      setDetailScheduleDraft(null);
      setDetailScheduleUi({
        isTemplateExpanded: false,
        activeQuickRow: null,
        isActionsSheetOpen: false,
      });
      return;
    }
    const nextBase = buildDetailScheduleDraft(nextSchedulePreferences);
    const shouldPreserveDraft = (
      detailScheduleDraft
      && detailScheduleBase
      && !areScheduleDraftsEqual(detailScheduleDraft, detailScheduleBase)
    );
    setDetailScheduleBase(nextBase);
    setDetailScheduleDraft(shouldPreserveDraft ? detailScheduleDraft : nextBase);
    if (!shouldPreserveDraft) {
      setDetailScheduleUi({
        isTemplateExpanded: !hasConfiguredTemplate(nextBase),
        activeQuickRow: null,
        isActionsSheetOpen: false,
      });
    }
  // Preserve detail edits unless the incoming payload changes from a clean base.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailPayload?.schedule_preferences]);

  const handleOpenClientDetail = async (clientId) => {
    setCommandCenterActionsClientId(null);
    setSelectedClientId(clientId);
    setViewMode(VIEW_MODE.CLIENT_DETAIL);
    setIsDetailContextExpanded(false);
    setDetailScheduleError(null);
    setDetailScheduleSuccess(null);
    setDetailScheduleUi({
      isTemplateExpanded: false,
      activeQuickRow: null,
      isActionsSheetOpen: false,
    });
    await loadClientDetailView(clientId);
  };

  const handleOpenClientSetup = async (
    clientId,
    {
      focusSection = 'schedule',
      origin = VIEW_MODE.COMMAND_CENTER,
    } = {},
  ) => {
    if (!accessToken || !clientId) {
      return;
    }
    setCommandCenterActionsClientId(null);
    setSetupClientId(clientId);
    setSetupReturnView(origin);
    setSetupFocusSection(focusSection);
    setSetupError(null);
    setSetupSuccess(null);
    setIsLoadingSetup(true);
    setViewMode(VIEW_MODE.CLIENT_SETUP);
    try {
      const [schedulePreferences, memoryRecordsPayload] = await Promise.all([
        getTrainerClientSchedulePreferences({
          accessToken,
          clientId,
          date: plannerDate,
        }),
        listTrainerClientMemory({
          accessToken,
          clientId,
        }),
      ]);
      const notesRecord = findClientSetupNotesRecord(memoryRecordsPayload);
      setSetupNotesMemoryId(notesRecord?.id || null);
      setSetupDraft({
        recurringWeekdays: Array.isArray(schedulePreferences?.recurring_weekdays)
          ? schedulePreferences.recurring_weekdays
          : [],
        preferredMeetingLocation: String(schedulePreferences?.preferred_meeting_location || ''),
        autoUseTrainerDefaultLocation: schedulePreferences?.auto_use_trainer_default_location !== false,
        overrideMode: normalizeSetupOverrideMode(schedulePreferences?.selected_date_exception_type),
        overrideLocation: String(schedulePreferences?.selected_date_meeting_location_override || ''),
        trainerDefaultLocation: String(schedulePreferences?.trainer_default_meeting_location || ''),
        trainerAutoFillLocation: schedulePreferences?.trainer_auto_fill_meeting_location !== false,
        notesText: String(notesRecord?.text || ''),
      });
    } catch (error) {
      setSetupDraft(null);
      setSetupError(error?.message || 'Unable to load client setup.');
    } finally {
      setIsLoadingSetup(false);
    }
  };

  const handleBackFromClientSetup = () => {
    const nextViewMode = setupReturnView === VIEW_MODE.CLIENT_DETAIL
      ? VIEW_MODE.CLIENT_DETAIL
      : VIEW_MODE.COMMAND_CENTER;
    setViewMode(nextViewMode);
    setSetupError(null);
    setSetupSuccess(null);
    setSetupClientId(null);
    setSetupDraft(null);
    setSetupNotesMemoryId(null);
    setSetupFocusSection('schedule');
  };

  const handleBackToCommandCenter = () => {
    setViewMode(VIEW_MODE.COMMAND_CENTER);
    setIsDetailContextExpanded(false);
    cancelEditMemory();
    setDetailError(null);
    setMemoryMutationError(null);
    setMemoryMutationSuccess(null);
    setDetailScheduleError(null);
    setDetailScheduleSuccess(null);
    setDetailScheduleUi({
      isTemplateExpanded: false,
      activeQuickRow: null,
      isActionsSheetOpen: false,
    });
  };

  const resetNewMemoryForm = () => {
    setNewMemoryText('');
    setNewMemoryTagsText('');
    setNewMemoryAiReadable(false);
    setIsNewMemoryTagsVisible(false);
  };

  const handleCreateMemory = async () => {
    if (!accessToken || !selectedClientId || isSavingMemory) {
      return;
    }
    const trimmedText = newMemoryText.trim();
    if (!trimmedText) {
      setMemoryMutationError('Add memory text before saving.');
      return;
    }
    setIsSavingMemory(true);
    setMemoryMutationError(null);
    setMemoryMutationSuccess(null);
    try {
      await createTrainerClientMemory({
        accessToken,
        clientId: selectedClientId,
        memoryType: 'note',
        text: trimmedText,
        visibility: newMemoryAiReadable ? 'ai_usable' : 'internal_only',
        tags: parseTags(newMemoryTagsText),
      });
      await loadClientDetailView(selectedClientId);
      await loadCommandCenter({ refreshTalkingPoints: true, silent: true });
      resetNewMemoryForm();
      setMemoryMutationSuccess('Memory saved.');
    } catch (error) {
      setMemoryMutationError(error?.message || 'Unable to save memory.');
    } finally {
      setIsSavingMemory(false);
    }
  };

  const startEditMemory = (record) => {
    setEditingMemoryId(record.id);
    setEditingText(record.text || '');
    setEditingAiReadable(record.visibility === 'ai_usable');
    setEditingTagsText(Array.isArray(record.tags) ? record.tags.join(', ') : '');
    setIsEditingTagsVisible(Boolean(Array.isArray(record.tags) && record.tags.length > 0));
    setMemoryMutationError(null);
    setMemoryMutationSuccess(null);
  };

  const cancelEditMemory = () => {
    setEditingMemoryId(null);
    setEditingText('');
    setEditingAiReadable(false);
    setEditingTagsText('');
    setIsEditingTagsVisible(false);
  };

  const handleSaveMemoryEdit = async () => {
    if (!accessToken || !selectedClientId || !editingMemoryId || isSavingMemory) {
      return;
    }
    const trimmedText = editingText.trim();
    if (!trimmedText) {
      setMemoryMutationError('Memory text cannot be empty.');
      return;
    }
    setIsSavingMemory(true);
    setMemoryMutationError(null);
    setMemoryMutationSuccess(null);
    try {
      await updateTrainerClientMemory({
        accessToken,
        clientId: selectedClientId,
        memoryId: editingMemoryId,
        text: trimmedText,
        visibility: editingAiReadable ? 'ai_usable' : 'internal_only',
        tags: parseTags(editingTagsText),
      });
      await loadClientDetailView(selectedClientId);
      await loadCommandCenter({ refreshTalkingPoints: true, silent: true });
      cancelEditMemory();
      setMemoryMutationSuccess('Memory updated.');
    } catch (error) {
      setMemoryMutationError(error?.message || 'Unable to update memory.');
    } finally {
      setIsSavingMemory(false);
    }
  };

  const handleArchiveMemory = async (memoryId) => {
    if (!accessToken || !selectedClientId || isSavingMemory) {
      return;
    }
    setIsSavingMemory(true);
    setMemoryMutationError(null);
    setMemoryMutationSuccess(null);
    try {
      await archiveTrainerClientMemory({
        accessToken,
        clientId: selectedClientId,
        memoryId,
      });
      await loadClientDetailView(selectedClientId);
      await loadCommandCenter({ refreshTalkingPoints: true, silent: true });
      if (editingMemoryId === memoryId) {
        cancelEditMemory();
      }
      setMemoryMutationSuccess('Memory archived.');
    } catch (error) {
      setMemoryMutationError(error?.message || 'Unable to archive memory.');
    } finally {
      setIsSavingMemory(false);
    }
  };

  const patchScheduleUiByClient = (clientId, nextFields) => {
    setScheduleUiByClient((previousUiByClient) => ({
      ...previousUiByClient,
      [clientId]: {
        ...buildScheduleUiState(
          scheduleDraftByClient[clientId]
          || scheduleBaseByClient[clientId]
          || buildClientScheduleDraft(clientItems.find((item) => item.client_id === clientId)),
        ),
        ...(previousUiByClient[clientId] || {}),
        ...nextFields,
      },
    }));
  };

  const handleScheduleDraftPatch = (clientId, nextFields) => {
    setScheduleDraftByClient((previousDraftByClient) => ({
      ...previousDraftByClient,
      [clientId]: {
        ...buildClientScheduleDraft(clientItems.find((item) => item.client_id === clientId)),
        ...(previousDraftByClient[clientId] || {}),
        ...nextFields,
      },
    }));
    setScheduleTouchedByClient((previousTouchedByClient) => ({
      ...previousTouchedByClient,
      [clientId]: true,
    }));
    setScheduleFeedbackByClient((previousFeedbackByClient) => ({
      ...previousFeedbackByClient,
      [clientId]: {
        error: null,
        success: null,
      },
    }));
  };

  // Preserved for follow-up schedule UI restoration; current rendered flow does not call it.
  // eslint-disable-next-line no-unused-vars
  const handleToggleClientWeekday = (clientId, weekday) => {
    const current = scheduleDraftByClient[clientId] || buildClientScheduleDraft(
      clientItems.find((item) => item.client_id === clientId),
    );
    handleScheduleDraftPatch(clientId, {
      recurringWeekdays: toggleIsoWeekday(current.recurringWeekdays, weekday),
    });
  };

  // Preserved for follow-up schedule UI restoration; current rendered flow does not call it.
  // eslint-disable-next-line no-unused-vars
  const saveClientSchedulePreferences = async (clientId) => {
    if (!accessToken || !clientId || savingScheduleClientId) {
      return;
    }
    const draft = scheduleDraftByClient[clientId] || buildClientScheduleDraft(
      clientItems.find((item) => item.client_id === clientId),
    );
    setSavingScheduleClientId(clientId);
    setScheduleFeedbackByClient((previousFeedbackByClient) => ({
      ...previousFeedbackByClient,
      [clientId]: {
        error: null,
        success: null,
      },
    }));
    try {
      const preferredMeetingLocation = String(draft.preferredMeetingLocation || '').trim();
      await patchTrainerClientSchedulePreferences({
        accessToken,
        clientId,
        recurringWeekdays: draft.recurringWeekdays,
        preferredMeetingLocation: preferredMeetingLocation || null,
        autoUseTrainerDefaultLocation: Boolean(draft.autoUseTrainerDefaultLocation),
      });
      const savedDraft = {
        ...draft,
        preferredMeetingLocation,
      };
      setScheduleBaseByClient((previousBaseByClient) => ({
        ...previousBaseByClient,
        [clientId]: savedDraft,
      }));
      if (hasConfiguredTemplate(savedDraft)) {
        patchScheduleUiByClient(clientId, {
          isTemplateExpanded: false,
          activeQuickRow: null,
        });
      }
      await loadCommandCenter({ silent: true });
      setScheduleTouchedByClient((previousTouchedByClient) => ({
        ...previousTouchedByClient,
        [clientId]: false,
      }));
      setScheduleFeedbackByClient((previousFeedbackByClient) => ({
        ...previousFeedbackByClient,
        [clientId]: {
          error: null,
          success: 'Schedule saved.',
        },
      }));
    } catch (error) {
      setScheduleFeedbackByClient((previousFeedbackByClient) => ({
        ...previousFeedbackByClient,
        [clientId]: {
          error: error?.message || 'Unable to save schedule template.',
          success: null,
        },
      }));
    } finally {
      setSavingScheduleClientId(null);
    }
  };

  const applyClientDateException = async (clientId, exceptionType) => {
    if (!accessToken || !clientId || savingScheduleClientId) {
      return;
    }
    const draft = scheduleDraftByClient[clientId] || {};
    setSavingScheduleClientId(clientId);
    setScheduleFeedbackByClient((previousFeedbackByClient) => ({
      ...previousFeedbackByClient,
      [clientId]: {
        error: null,
        success: null,
      },
    }));
    try {
      const exceptionLocationOverride = String(draft.exceptionLocationOverride || '').trim();
      await createTrainerClientScheduleException({
        accessToken,
        clientId,
        sessionDate: plannerDate,
        exceptionType,
        meetingLocationOverride: exceptionLocationOverride || null,
      });
      setScheduleDraftByClient((previousDraftByClient) => ({
        ...previousDraftByClient,
        [clientId]: {
          ...(previousDraftByClient[clientId] || buildClientScheduleDraft(clientItems.find((item) => item.client_id === clientId))),
          exceptionType,
        },
      }));
      setCommandCenterActionsClientId((previousClientId) => (
        previousClientId === clientId ? null : previousClientId
      ));
      await loadCommandCenter({ silent: true });
      if (selectedClientId === clientId) {
        await loadClientDetailView(clientId);
      }
      setScheduleFeedbackByClient((previousFeedbackByClient) => ({
        ...previousFeedbackByClient,
        [clientId]: {
          error: null,
          success: exceptionType === 'skip'
            ? `Marked ${plannerDayLabel} as skipped.`
            : `Added one-off session for ${plannerDayLabel}.`,
        },
      }));
    } catch (error) {
      setScheduleFeedbackByClient((previousFeedbackByClient) => ({
        ...previousFeedbackByClient,
        [clientId]: {
          error: error?.message || 'Unable to save schedule exception.',
          success: null,
        },
      }));
    } finally {
      setSavingScheduleClientId(null);
    }
  };

  const clearClientDateException = async (clientId) => {
    if (!accessToken || !clientId || savingScheduleClientId) {
      return;
    }
    setSavingScheduleClientId(clientId);
    setScheduleFeedbackByClient((previousFeedbackByClient) => ({
      ...previousFeedbackByClient,
      [clientId]: {
        error: null,
        success: null,
      },
    }));
    try {
      await deleteTrainerClientScheduleException({
        accessToken,
        clientId,
        sessionDate: plannerDate,
      });
      setScheduleDraftByClient((previousDraftByClient) => ({
        ...previousDraftByClient,
        [clientId]: {
          ...(previousDraftByClient[clientId] || buildClientScheduleDraft(clientItems.find((item) => item.client_id === clientId))),
          exceptionType: null,
        },
      }));
      setCommandCenterActionsClientId((previousClientId) => (
        previousClientId === clientId ? null : previousClientId
      ));
      await loadCommandCenter({ silent: true });
      if (selectedClientId === clientId) {
        await loadClientDetailView(clientId);
      }
      setScheduleFeedbackByClient((previousFeedbackByClient) => ({
        ...previousFeedbackByClient,
        [clientId]: {
          error: null,
          success: 'Date override cleared.',
        },
      }));
    } catch (error) {
      if (String(error?.message || '').toLowerCase() === 'schedule exception not found') {
        setScheduleFeedbackByClient((previousFeedbackByClient) => ({
          ...previousFeedbackByClient,
          [clientId]: {
            error: null,
            success: 'No date override was set.',
          },
        }));
      } else {
        setScheduleFeedbackByClient((previousFeedbackByClient) => ({
          ...previousFeedbackByClient,
          [clientId]: {
            error: error?.message || 'Unable to clear schedule exception.',
            success: null,
          },
        }));
      }
    } finally {
      setSavingScheduleClientId(null);
    }
  };

  const patchDetailScheduleDraft = (nextFields) => {
    setDetailScheduleDraft((previous) => ({
      ...(previous || buildDetailScheduleDraft(detailPayload?.schedule_preferences)),
      ...nextFields,
    }));
    setDetailScheduleError(null);
    setDetailScheduleSuccess(null);
  };

  // Preserved for follow-up schedule UI restoration; current rendered flow does not call it.
  // eslint-disable-next-line no-unused-vars
  const handleToggleDetailWeekday = (weekday) => {
    const currentWeekdays = Array.isArray(detailScheduleDraft?.recurringWeekdays)
      ? detailScheduleDraft.recurringWeekdays
      : [];
    patchDetailScheduleDraft({
      recurringWeekdays: toggleIsoWeekday(currentWeekdays, weekday),
    });
  };

  // Preserved for follow-up schedule UI restoration; current rendered flow does not call it.
  // eslint-disable-next-line no-unused-vars
  const saveDetailScheduleTemplate = async () => {
    if (!accessToken || !selectedClientId || isSavingDetailSchedule || !detailScheduleDraft) {
      return;
    }
    setIsSavingDetailSchedule(true);
    setDetailScheduleError(null);
    setDetailScheduleSuccess(null);
    try {
      const preferredMeetingLocation = String(detailScheduleDraft.preferredMeetingLocation || '').trim();
      await patchTrainerClientSchedulePreferences({
        accessToken,
        clientId: selectedClientId,
        recurringWeekdays: detailScheduleDraft.recurringWeekdays,
        preferredMeetingLocation: preferredMeetingLocation || null,
        autoUseTrainerDefaultLocation: Boolean(detailScheduleDraft.autoUseTrainerDefaultLocation),
      });
      const savedDraft = {
        ...detailScheduleDraft,
        preferredMeetingLocation,
      };
      setDetailScheduleBase(savedDraft);
      if (hasConfiguredTemplate(savedDraft)) {
        setDetailScheduleUi((previousUi) => ({
          ...previousUi,
          isTemplateExpanded: false,
          activeQuickRow: null,
        }));
      }
      await loadClientDetailView(selectedClientId);
      await loadCommandCenter({ silent: true });
      setDetailScheduleSuccess('Schedule saved.');
    } catch (error) {
      setDetailScheduleError(error?.message || 'Unable to save schedule template.');
    } finally {
      setIsSavingDetailSchedule(false);
    }
  };

  // Preserved for follow-up schedule UI restoration; current rendered flow does not call it.
  // eslint-disable-next-line no-unused-vars
  const setDetailDateException = async (exceptionType) => {
    if (!accessToken || !selectedClientId || isSavingDetailSchedule || !detailScheduleDraft) {
      return;
    }
    setIsSavingDetailSchedule(true);
    setDetailScheduleError(null);
    setDetailScheduleSuccess(null);
    try {
      const meetingLocationOverride = String(detailScheduleDraft.exceptionLocationOverride || '').trim();
      await createTrainerClientScheduleException({
        accessToken,
        clientId: selectedClientId,
        sessionDate: plannerDate,
        exceptionType,
        meetingLocationOverride: meetingLocationOverride || null,
      });
      setDetailScheduleDraft((previousDraft) => ({
        ...(previousDraft || buildDetailScheduleDraft(detailPayload?.schedule_preferences)),
        exceptionType,
      }));
      setDetailScheduleUi((previousUi) => ({
        ...previousUi,
        isActionsSheetOpen: false,
      }));
      await loadClientDetailView(selectedClientId);
      await loadCommandCenter({ silent: true });
      setDetailScheduleSuccess(
        exceptionType === 'skip'
          ? `Marked ${plannerDayLabel} as skipped.`
          : `Added one-off session for ${plannerDayLabel}.`,
      );
    } catch (error) {
      setDetailScheduleError(error?.message || 'Unable to save date exception.');
    } finally {
      setIsSavingDetailSchedule(false);
    }
  };

  // Preserved for follow-up schedule UI restoration; current rendered flow does not call it.
  // eslint-disable-next-line no-unused-vars
  const clearDetailDateException = async () => {
    if (!accessToken || !selectedClientId || isSavingDetailSchedule) {
      return;
    }
    setIsSavingDetailSchedule(true);
    setDetailScheduleError(null);
    setDetailScheduleSuccess(null);
    try {
      await deleteTrainerClientScheduleException({
        accessToken,
        clientId: selectedClientId,
        sessionDate: plannerDate,
      });
      setDetailScheduleDraft((previousDraft) => ({
        ...(previousDraft || buildDetailScheduleDraft(detailPayload?.schedule_preferences)),
        exceptionType: null,
      }));
      setDetailScheduleUi((previousUi) => ({
        ...previousUi,
        isActionsSheetOpen: false,
      }));
      await loadClientDetailView(selectedClientId);
      await loadCommandCenter({ silent: true });
      setDetailScheduleSuccess('Date override cleared.');
    } catch (error) {
      if (String(error?.message || '').toLowerCase() === 'schedule exception not found') {
        setDetailScheduleSuccess('No date override was set.');
      } else {
        setDetailScheduleError(error?.message || 'Unable to clear date override.');
      }
    } finally {
      setIsSavingDetailSchedule(false);
    }
  };

  const patchSetupDraft = (nextFields) => {
    setSetupDraft((previousDraft) => ({
      ...(previousDraft || {}),
      ...nextFields,
    }));
    setSetupError(null);
    setSetupSuccess(null);
  };

  const handleToggleSetupRecurringWeekday = (weekday) => {
    const currentWeekdays = Array.isArray(setupDraft?.recurringWeekdays)
      ? setupDraft.recurringWeekdays
      : [];
    patchSetupDraft({
      recurringWeekdays: toggleIsoWeekday(currentWeekdays, weekday),
    });
  };

  const saveClientSetup = async () => {
    if (!accessToken || !setupClientId || !setupDraft || isSavingSetup) {
      return;
    }
    setIsSavingSetup(true);
    setSetupError(null);
    setSetupSuccess(null);
    try {
      const preferredMeetingLocation = String(setupDraft.preferredMeetingLocation || '').trim();
      const overrideLocation = String(setupDraft.overrideLocation || '').trim();
      const notesText = String(setupDraft.notesText || '').trim();

      await patchTrainerClientSchedulePreferences({
        accessToken,
        clientId: setupClientId,
        recurringWeekdays: Array.isArray(setupDraft.recurringWeekdays) ? setupDraft.recurringWeekdays : [],
        preferredMeetingLocation: preferredMeetingLocation || null,
        autoUseTrainerDefaultLocation: Boolean(setupDraft.autoUseTrainerDefaultLocation),
      });

      if (setupDraft.overrideMode === 'none') {
        try {
          await deleteTrainerClientScheduleException({
            accessToken,
            clientId: setupClientId,
            sessionDate: plannerDate,
          });
        } catch (error) {
          const message = String(error?.message || '').toLowerCase();
          if (message !== 'schedule exception not found') {
            throw error;
          }
        }
      } else {
        await createTrainerClientScheduleException({
          accessToken,
          clientId: setupClientId,
          sessionDate: plannerDate,
          exceptionType: setupDraft.overrideMode,
          meetingLocationOverride: setupDraft.overrideMode === 'add'
            ? (overrideLocation || null)
            : null,
        });
      }

      if (setupNotesMemoryId) {
        if (notesText) {
          await updateTrainerClientMemory({
            accessToken,
            clientId: setupClientId,
            memoryId: setupNotesMemoryId,
            text: notesText,
            visibility: 'ai_usable',
            tags: ['client_setup'],
            memoryKey: CLIENT_SETUP_NOTES_MEMORY_KEY,
            structuredData: {
              source: 'client_setup_editor',
              version: 'v1',
            },
          });
        } else {
          await archiveTrainerClientMemory({
            accessToken,
            clientId: setupClientId,
            memoryId: setupNotesMemoryId,
          });
          setSetupNotesMemoryId(null);
        }
      } else if (notesText) {
        const createdNotes = await createTrainerClientMemory({
          accessToken,
          clientId: setupClientId,
          memoryType: 'note',
          memoryKey: CLIENT_SETUP_NOTES_MEMORY_KEY,
          text: notesText,
          visibility: 'ai_usable',
          tags: ['client_setup'],
          structuredData: {
            source: 'client_setup_editor',
            version: 'v1',
          },
        });
        setSetupNotesMemoryId(createdNotes?.id || null);
      }

      setSetupDraft((previousDraft) => ({
        ...(previousDraft || {}),
        preferredMeetingLocation,
        overrideLocation,
        notesText,
      }));
      await loadCommandCenter({ silent: true });
      if (selectedClientId === setupClientId) {
        await loadClientDetailView(setupClientId);
      }
      setSetupSuccess('Client setup saved.');
    } catch (error) {
      setSetupError(error?.message || 'Unable to save client setup.');
    } finally {
      setIsSavingSetup(false);
    }
  };

  const handleRefreshCommandCenter = async ({ refreshTalkingPoints = false } = {}) => {
    await Promise.all([
      loadCommandCenter({ refreshTalkingPoints }),
      loadDraftQueue({ silent: refreshTalkingPoints }),
    ]);
  };

  const handleSetTopSummaryCollapsed = useCallback(async (nextCollapsed) => {
    const normalized = Boolean(nextCollapsed);
    setIsTopSummaryCollapsed(normalized);
    if (!summaryVisibilityTrainerId) {
      return;
    }
    try {
      await saveTrainerClientsSummaryVisibility(summaryVisibilityTrainerId, { collapsed: normalized });
    } catch (_error) {
      // Keep UI responsive even if local preference persistence fails.
    }
  }, [summaryVisibilityTrainerId]);

  const runDraftReviewMutation = async (
    actionType,
    {
      reasonOverride = null,
      launchRegenerationIntent = false,
    } = {},
  ) => {
    if (!accessToken || !activeDraft?.output_id || isMutatingDraftReview) {
      return;
    }

    const outputId = activeDraft.output_id;
    const uiState = activeDraftModel && typeof activeDraftModel === 'object'
      ? activeDraftModel
      : transformPlan(activeDraft);
    const { editedOutputJson, editedOutputText } = rebuildJSON(uiState, activeDraft);
    const nextQueueState = buildNextDraftReviewState(draftQueueItems, outputId);

    setIsMutatingDraftReview(true);
    setDraftReviewMutationError(null);
    setDraftReviewMutationSuccess(null);

    try {
      if (actionType === DRAFT_REVIEW_ACTION_TYPE.APPROVE) {
        await approveTrainerCoachQueueItem({
          accessToken,
          outputId,
          editedOutputText,
          editedOutputJson,
          applyBundle: {},
          idempotencyKey: buildDraftReviewIdempotencyKey('clients-approve'),
        });
      } else {
        await rejectTrainerCoachQueueItem({
          accessToken,
          outputId,
          reason: reasonOverride || 'Rejected from Clients Draft Review flow.',
          editedOutputText,
          editedOutputJson,
        });
      }

      setDraftQueueItems(nextQueueState.optimisticItems);
      setActiveDraftOutputId(nextQueueState.nextOutputId);

      const trackerSnapshot = await recordDraftReviewAction(
        draftReviewTrackerScopeId,
        {
          actionType,
          outputId,
        },
      );
      setDraftReviewTracker(trackerSnapshot);

      if (actionType === DRAFT_REVIEW_ACTION_TYPE.APPROVE) {
        setDraftReviewMutationSuccess('Draft approved. Moving to the next draft.');
      } else if (launchRegenerationIntent) {
        setDraftReviewMutationSuccess('Draft rejected and regeneration launched in Coach.');
      } else {
        setDraftReviewMutationSuccess('Draft rejected. Moving to the next draft.');
      }

      if (launchRegenerationIntent && typeof onOpenTrainerCoach === 'function') {
        onOpenTrainerCoach(buildRegenerationLaunchContext(activeDraft, uiState));
      }

      await loadDraftQueue({
        silent: true,
        preferredOutputId: nextQueueState.nextOutputId,
        allowNullSelection: nextQueueState.allowNullSelection,
      });
    } catch (error) {
      setDraftReviewMutationError(error?.message || 'Unable to process draft review action.');
      await loadDraftQueue({ silent: true });
    } finally {
      setIsMutatingDraftReview(false);
    }
  };

  const handleRetryDraftRender = () => {
    if (!activeDraft) {
      return;
    }
    setActiveDraftModel(transformPlan(activeDraft));
    setDraftReviewMutationError(null);
    setDraftReviewMutationSuccess('Draft rendering refreshed.');
  };

  const handleRegenerateDraft = async () => {
    await runDraftReviewMutation(
      DRAFT_REVIEW_ACTION_TYPE.REJECT,
      {
        reasonOverride: 'Rejected for regeneration from Clients Draft Review flow.',
        launchRegenerationIntent: true,
      },
    );
  };

  const handleStartDraftQueueFromTop = () => {
    if (!Array.isArray(draftQueueItems) || draftQueueItems.length === 0) {
      setActiveDraftOutputId(null);
      return;
    }
    setActiveDraftOutputId(draftQueueItems[0].output_id);
  };

  const totals = commandCenterPayload?.totals || {
    assigned_clients: 0,
    scheduled_today: 0,
    checkins_completed_today: 0,
    high_priority_clients: 0,
    critical_priority_clients: 0,
  };
  const trainerOnboardingCompleted = commandCenterPayload?.trainer?.trainer_onboarding_completed !== false;
  const summaryStatus = deriveSummaryStatus({
    trainerOnboardingCompleted,
    draftQueueCount,
    highPriorityClients: totals.high_priority_clients,
    criticalPriorityClients: totals.critical_priority_clients,
  });
  const plannerDayLabel = selectedDayConfig.label;
  const plannerDateLabel = formatPlannerDateLabel(commandCenterPayload?.date || plannerDate);
  const setupClientName = (
    detailPayload?.client?.client_id === setupClientId
      ? detailPayload?.client?.client_name
      : null
  ) || setupClientFromList?.client_name || 'Client';

  const commandCenterClientKeyExtractor = (client) => (
    String(client?.client_id || '')
  );

  const renderCommandCenterClient = ({ item: client }) => {
    const clientId = client.client_id;
    return (
      <ClientTodayCard
        client={client}
        plannerDayLabel={plannerDayLabel}
        isActionsOpen={commandCenterActionsClientId === clientId}
        isMutatingActions={Boolean(savingScheduleClientId)}
        onOpenActions={() => setCommandCenterActionsClientId(clientId)}
        onCloseActions={() => setCommandCenterActionsClientId((previousClientId) => (
          previousClientId === clientId ? null : previousClientId
        ))}
        onEditSessionSetup={() => handleOpenClientSetup(clientId, {
          focusSection: 'schedule',
          origin: VIEW_MODE.COMMAND_CENTER,
        })}
        onEditClientNotes={() => handleOpenClientSetup(clientId, {
          focusSection: 'notes',
          origin: VIEW_MODE.COMMAND_CENTER,
        })}
        onApplySkip={() => applyClientDateException(clientId, 'skip')}
        onApplyAdd={() => applyClientDateException(clientId, 'add')}
        onClearOverride={() => clearClientDateException(clientId)}
        onOpenClientDetail={() => handleOpenClientDetail(clientId)}
      />
    );
  };

  if (viewMode === VIEW_MODE.CLIENT_SETUP) {
    return (
      <SafeScreen
        includeTopInset={false}
        style={styles.screen}
        atmosphere="clients"
        atmosphereOverlayStrength={0.95}
      >
        <HeaderBar
          title={setupClientName}
          subtitle="Edit client session setup and notes"
        />
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: theme.spacing[5] + bottomInset },
          ]}
        >
          <ClientSetupScreen
            clientName={setupClientName}
            plannerDayLabel={plannerDayLabel}
            setupDraft={setupDraft}
            setupFocusSection={setupFocusSection}
            setupError={setupError}
            setupSuccess={setupSuccess}
            isLoading={isLoadingSetup}
            isSaving={isSavingSetup}
            onBack={handleBackFromClientSetup}
            onPatchDraft={patchSetupDraft}
            onToggleRecurringWeekday={handleToggleSetupRecurringWeekday}
            onSave={saveClientSetup}
          />
        </ScrollView>
      </SafeScreen>
    );
  }

  if (viewMode === VIEW_MODE.CLIENT_DETAIL) {
    const detailClientName = detailPayload?.client?.client_name
      || selectedClientFromList?.client_name
      || 'Client Detail';
    const activity = detailPayload?.activity_summary || {};
    const profile = detailPayload?.profile_snapshot || {};
    const schedulePreferences = detailPayload?.schedule_preferences || null;
    const effectiveDetailDraft = detailScheduleDraft || buildDetailScheduleDraft(schedulePreferences);
    const upcomingExceptions = Array.isArray(schedulePreferences?.upcoming_exceptions)
      ? schedulePreferences.upcoming_exceptions
      : [];
    const detailScheduledToday = Boolean(activity.scheduled_today);
    const detailStatusLabel = effectiveDetailDraft.exceptionType === 'skip'
      ? `${plannerDayLabel} skipped`
      : effectiveDetailDraft.exceptionType === 'add'
        ? `${plannerDayLabel} added`
        : (detailScheduledToday ? 'Scheduled today' : 'No session today');
    const detailSummaryLine = detailScheduledToday
      ? `Session today • ${formatSessionWindow(activity.session_start_at, activity.session_end_at)}`
      : 'No session scheduled today';
    const detailSummaryMeta = formatOverrideSummary({
      exceptionType: effectiveDetailDraft.exceptionType || schedulePreferences?.selected_date_exception_type,
      plannerDayLabel,
      isScheduledForSelectedDay: detailScheduledToday,
    });
    const detailMetricLine = `${activity.checkins_completed_7d || 0} check-ins • avg ${formatAvgScore(activity.avg_score_7d)} • ${activity.workouts_completed_7d || 0} workouts`;
    const detailQuestionSummaries = getQuestionSummaries(activity);
    const isDetailQuestionSummariesMissing = !hasQuestionSummariesField(activity);
    const detailSignalWindowLabel = buildSignalWindowLabel(plannerDate);
    const aiUsableMemory = Array.isArray(aiContextPayload?.applied_ai_usable_memory)
      ? aiContextPayload.applied_ai_usable_memory
      : [];
    const ruleSummary = Array.isArray(aiContextPayload?.trainer_rule_summary)
      ? aiContextPayload.trainer_rule_summary
      : [];

    return (
      <SafeScreen
        includeTopInset={false}
        style={styles.screen}
        atmosphere="clients"
        atmosphereOverlayStrength={0.95}
      >
        <HeaderBar
          title={detailClientName}
          subtitle="Trainer-side client memory and AI context"
          onBack={handleBackToCommandCenter}
          backAccessibilityLabel="Back to Command Center"
        />
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: theme.spacing[4] + bottomInset },
          ]}
        >
          {!breathingTransitionsEnabled && isLoadingDetail ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={theme.colors.accent.primary} />
              <ModeText variant="bodySm" tone="secondary">Loading client detail...</ModeText>
            </View>
          ) : null}

          {!isLoadingDetail && detailError ? (
            <ModeCard variant="surface">
              <ModeText variant="bodySm" tone="error">{detailError.message}</ModeText>
              {detailError.isStaleBackendRoute ? (
                <View style={styles.routeDiagnosticBlock}>
                  <ModeText variant="bodySm" tone="secondary">
                    The backend appears stale and is missing trainer client routes.
                  </ModeText>
                  {detailError.requestPath ? (
                    <ModeText variant="caption" tone="tertiary">
                      Missing route: {detailError.requestPath}
                    </ModeText>
                  ) : null}
                  {detailError.apiBase ? (
                    <ModeText variant="caption" tone="tertiary">
                      API base: {detailError.apiBase}
                    </ModeText>
                  ) : null}
                  <ModeText variant="caption" tone="tertiary">
                    Restart or redeploy backend from current repo code, then verify `/openapi.json`.
                  </ModeText>
                </View>
              ) : null}
              <ModeButton
                title="Retry"
                variant="secondary"
                onPress={() => loadClientDetailView(selectedClientId)}
                style={styles.actionButton}
              />
            </ModeCard>
          ) : null}

          {!isLoadingDetail && !detailError ? (
            <>
              <QuestionSignalDetailSection
                questionSummaries={detailQuestionSummaries}
                isMissingFromBackend={isDetailQuestionSummariesMissing}
                windowLabel={detailSignalWindowLabel}
              />

              <ModeCard variant="surface" style={styles.memoryHubCard}>
                <View style={styles.memorySectionHeaderRow}>
                  <ModeText variant="label" tone="tertiary" style={styles.memorySectionLabel}>Client Memory</ModeText>
                  <ModeText variant="caption" tone="secondary">{memoryRecords.length} saved</ModeText>
                </View>
                <ModeInput
                  testID="trainer-client-memory-composer-input"
                  value={newMemoryText}
                  onChangeText={setNewMemoryText}
                  placeholder="Add memory note..."
                />
                <View style={styles.memoryToggleRow}>
                  <ModeText variant="bodySm">AI can read this</ModeText>
                  <GlassToggle
                    testID="trainer-client-memory-composer-ai-toggle"
                    value={newMemoryAiReadable}
                    onValueChange={setNewMemoryAiReadable}
                    disabled={isSavingMemory}
                  />
                </View>
                {isNewMemoryTagsVisible ? (
                  <ModeInput
                    testID="trainer-client-memory-composer-tags-input"
                    value={newMemoryTagsText}
                    onChangeText={setNewMemoryTagsText}
                    placeholder="Tags (comma separated)"
                  />
                ) : (
                  <Pressable
                    testID="trainer-client-memory-composer-add-tags"
                    onPress={() => setIsNewMemoryTagsVisible(true)}
                    style={({ pressed }) => [styles.memoryTagsAction, pressed && styles.memoryTagsActionPressed]}
                    accessibilityRole="button"
                    accessibilityLabel="Add tags"
                  >
                    <ModeText variant="caption" tone="secondary" style={styles.memoryTagsActionText}>Add tags</ModeText>
                  </Pressable>
                )}
                <ModeButton
                  testID="trainer-client-memory-composer-save"
                  title={isSavingMemory ? 'Saving...' : 'Save Memory'}
                  size="sm"
                  variant="primary"
                  disabled={isSavingMemory}
                  onPress={handleCreateMemory}
                  style={styles.memorySaveButton}
                />
                {memoryMutationError ? (
                  <ModeText variant="caption" tone="error" style={styles.memoryInlineFeedback}>{memoryMutationError}</ModeText>
                ) : null}
                {memoryMutationSuccess ? (
                  <ModeText variant="caption" tone="secondary" style={styles.memoryInlineFeedback}>{memoryMutationSuccess}</ModeText>
                ) : null}

                <View style={styles.memoryDenseList}>
                  {memoryRecords.length === 0 ? (
                    <ModeText variant="bodySm" tone="secondary">No memory captured yet.</ModeText>
                  ) : (
                    memoryRecords.map((record) => {
                      const isAiUsable = record.visibility === 'ai_usable';
                      const metaLine = buildMemoryMetaLine(record);
                      return (
                        <Pressable
                          key={record.id}
                          testID={`trainer-client-memory-row-${record.id}`}
                          onPress={() => startEditMemory(record)}
                          style={({ pressed }) => [styles.memoryDenseRow, pressed && styles.memoryDenseRowPressed]}
                          accessibilityRole="button"
                          accessibilityLabel="Open memory editor"
                        >
                          <View style={styles.memoryDenseRowMain}>
                            <ModeText
                              variant="bodySm"
                              numberOfLines={1}
                              style={styles.memoryDenseRowText}
                            >
                              {record.text || 'No text captured.'}
                            </ModeText>
                            <ModeText
                              testID={`trainer-client-memory-meta-${record.id}`}
                              variant="caption"
                              tone="secondary"
                              numberOfLines={1}
                              style={styles.memoryDenseRowMeta}
                            >
                              {metaLine || 'No tags'}
                            </ModeText>
                          </View>

                          <View style={styles.memoryDenseRowRight}>
                            <View style={[
                              styles.memoryStatusBadge,
                              isAiUsable ? styles.memoryStatusBadgeAi : styles.memoryStatusBadgeInternal,
                            ]}
                            >
                              <ModeText
                                variant="caption"
                                tone={isAiUsable ? 'accent' : 'secondary'}
                                style={styles.memoryStatusBadgeText}
                              >
                                {isAiUsable ? 'AI' : 'Internal'}
                              </ModeText>
                            </View>
                            <View style={styles.memoryIconActions}>
                              <Pressable
                                testID={`trainer-client-memory-edit-${record.id}`}
                                onPress={(event) => {
                                  event?.stopPropagation?.();
                                  startEditMemory(record);
                                }}
                                style={({ pressed }) => [styles.memoryRowIconButton, pressed && styles.memoryRowIconButtonPressed]}
                                accessibilityRole="button"
                                accessibilityLabel="Edit memory"
                                hitSlop={8}
                              >
                                <Feather name="edit-2" size={14} color={theme.colors.text.secondary} />
                              </Pressable>
                              <Pressable
                                testID={`trainer-client-memory-archive-${record.id}`}
                                onPress={(event) => {
                                  event?.stopPropagation?.();
                                  handleArchiveMemory(record.id);
                                }}
                                style={({ pressed }) => [styles.memoryRowIconButton, pressed && styles.memoryRowIconButtonPressed]}
                                accessibilityRole="button"
                                accessibilityLabel="Archive memory"
                                hitSlop={8}
                              >
                                <Feather name="archive" size={14} color={theme.colors.text.secondary} />
                              </Pressable>
                            </View>
                          </View>
                        </Pressable>
                      );
                    })
                  )}
                </View>
              </ModeCard>

              <ModeCard variant="surface" style={styles.clientContextCard}>
                <Pressable
                  testID="trainer-client-context-toggle"
                  onPress={() => setIsDetailContextExpanded((current) => !current)}
                  style={({ pressed }) => [styles.clientContextToggle, pressed && styles.clientContextTogglePressed]}
                  accessibilityRole="button"
                  accessibilityLabel="Toggle client context"
                >
                  <View style={styles.clientContextToggleCopy}>
                    <ModeText variant="label" tone="tertiary" style={styles.memorySectionLabel}>Client Context</ModeText>
                    <ModeText variant="caption" tone="secondary" numberOfLines={1}>
                      {profile.primary_goal || 'Goal not set'} • {detailStatusLabel}
                    </ModeText>
                  </View>
                  <Feather
                    name={isDetailContextExpanded ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={theme.colors.text.secondary}
                  />
                </Pressable>

                {isDetailContextExpanded ? (
                  <View style={styles.clientContextExpanded}>
                    <View style={styles.clientContextGroup}>
                      <ModeText variant="caption" tone="tertiary">Profile</ModeText>
                      <ModeText variant="bodySm">Goal: {profile.primary_goal || 'Not set'}</ModeText>
                      <ModeText variant="caption" tone="secondary">
                        Onboarding: {profile.onboarding_status || 'unknown'} • Experience: {profile.experience_level || 'Not set'}
                      </ModeText>
                    </View>
                    <View style={styles.clientContextGroup}>
                      <ModeText variant="caption" tone="tertiary">Activity</ModeText>
                      <ModeText variant="caption" tone="secondary">
                        {activity.checkins_completed_7d || 0} check-ins • avg {formatAvgScore(activity.avg_score_7d)} • {activity.workouts_completed_7d || 0} workouts
                      </ModeText>
                      <ModeText variant="caption" tone="secondary">
                        Latest check-in: {formatDateLabel(activity.latest_checkin_date)} • Location: {activity.meeting_location || 'Not set'}
                      </ModeText>
                    </View>
                    <View style={styles.clientContextGroup}>
                      <ModeText variant="caption" tone="tertiary">Session Setup</ModeText>
                      <ModeText variant="caption" tone="secondary">{detailSummaryLine}</ModeText>
                      <ModeText variant="caption" tone="secondary">{detailSummaryMeta}</ModeText>
                      <ModeText variant="caption" tone="secondary">{detailMetricLine}</ModeText>
                      <ModeText variant="caption" tone="secondary">
                        Template days: {formatIsoWeekdaySummary(schedulePreferences?.recurring_weekdays)}
                      </ModeText>
                      <ModeText variant="caption" tone="secondary">
                        Client default location: {schedulePreferences?.preferred_meeting_location || 'Not set'}
                      </ModeText>
                      {upcomingExceptions.length > 0 ? (
                        <View style={styles.scheduleExceptionListCompact}>
                          {upcomingExceptions.map((exception) => (
                            <ModeText
                              key={`${exception.client_id || selectedClientId}-${exception.session_date}`}
                              variant="caption"
                              tone="secondary"
                            >
                              • {exception.session_date}: {exception.exception_type}
                              {exception.meeting_location_override ? ` @ ${exception.meeting_location_override}` : ''}
                            </ModeText>
                          ))}
                        </View>
                      ) : (
                        <ModeText variant="caption" tone="secondary">No upcoming date exceptions.</ModeText>
                      )}
                      <ModeButton
                        title="Edit Client Setup"
                        size="sm"
                        variant="secondary"
                        onPress={() => handleOpenClientSetup(selectedClientId, {
                          focusSection: 'schedule',
                          origin: VIEW_MODE.CLIENT_DETAIL,
                        })}
                        style={styles.clientContextActionButton}
                      />
                    </View>
                  </View>
                ) : null}
              </ModeCard>

              <ModeCard variant="surface">
                <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>How AI Sees This Client</ModeText>
                <ModeText variant="bodySm">
                  {aiContextPayload?.context_preview_text || 'AI context preview unavailable.'}
                </ModeText>
                <ModeText variant="bodySm" tone="secondary" style={styles.aiContextMeta}>
                  Internal-only memory excluded: {aiContextPayload?.internal_only_memory_count || 0}
                </ModeText>

                <View style={styles.aiContextSection}>
                  <ModeText variant="caption" tone="tertiary">Applied AI-Usable Memory</ModeText>
                  {aiUsableMemory.length > 0 ? (
                    aiUsableMemory.map((entry) => (
                      <ModeText key={entry.id} variant="bodySm" tone="secondary">
                        • {entry.text || entry.memory_key}
                      </ModeText>
                    ))
                  ) : (
                    <ModeText variant="bodySm" tone="secondary">No AI-usable memory applied yet.</ModeText>
                  )}
                </View>

                <View style={styles.aiContextSection}>
                  <ModeText variant="caption" tone="tertiary">Trainer Rule Summary</ModeText>
                  {ruleSummary.length > 0 ? (
                    ruleSummary.map((rule) => (
                      <ModeText key={rule.category} variant="bodySm" tone="secondary">
                        • {toTitleCase(rule.category)} ({rule.rule_count})
                      </ModeText>
                    ))
                  ) : (
                    <ModeText variant="bodySm" tone="secondary">No trainer rules summarized yet.</ModeText>
                  )}
                </View>
              </ModeCard>
            </>
          ) : null}
        </ScrollView>
        {breathingTransitionsEnabled ? (
          <BreathingTransitionOverlay
            active={isLoadingDetail}
            context={BREATHING_CONTEXT.CLIENT_CONTEXT_LOAD}
            variant="overlay"
            progressLabel="Loading client detail..."
            testID="trainer-clients-detail-breathing-loader"
          />
        ) : null}
        <MemoryEditSheet
          visible={Boolean(editingMemoryId && editingMemoryRecord)}
          record={editingMemoryRecord}
          isSaving={isSavingMemory}
          text={editingText}
          tagsText={editingTagsText}
          aiReadable={editingAiReadable}
          tagsVisible={isEditingTagsVisible}
          onChangeText={setEditingText}
          onChangeTagsText={setEditingTagsText}
          onToggleAiReadable={setEditingAiReadable}
          onShowTags={() => setIsEditingTagsVisible(true)}
          onSave={handleSaveMemoryEdit}
          onClose={cancelEditMemory}
        />
      </SafeScreen>
    );
  }

  return (
    <SafeScreen
      includeTopInset={false}
      style={styles.screen}
      atmosphere="clients"
      atmosphereOverlayStrength={0.95}
    >
      <HeaderBar
        title="Command Center"
        subtitle="Prioritized client risk scan and talking points"
      />

      <FlatList
        data={!isLoadingCommandCenter && !commandCenterError ? visibleClientItems : []}
        keyExtractor={commandCenterClientKeyExtractor}
        renderItem={renderCommandCenterClient}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: theme.spacing[4] + bottomInset },
        ]}
        ListHeaderComponent={() => (
          <>
        <Pressable
          testID={isTopSummaryCollapsed ? 'trainer-clients-summary-surface-collapsed' : 'trainer-clients-summary-surface-expanded'}
          onPress={() => {
            handleSetTopSummaryCollapsed(!isTopSummaryCollapsed);
          }}
          style={({ pressed }) => [pressed && styles.summaryTogglePressed]}
          accessibilityRole="button"
          accessibilityLabel={isTopSummaryCollapsed ? 'Expand command center summary' : 'Collapse command center summary'}
        >
          <ModeCard
            variant="hero"
            style={styles.heroTierCard}
            testID="trainer-clients-summary-card"
          >
            {isTopSummaryCollapsed ? (
              <View testID="trainer-clients-summary-collapsed-row" style={styles.summaryCollapsedRow}>
                <View style={styles.summaryCollapsedCopy}>
                  <ModeText variant="label" tone="tertiary" style={styles.summaryCollapsedLabel}>
                    {plannerDayLabel}{plannerDateLabel ? ` · ${plannerDateLabel}` : ''}
                  </ModeText>
                  <ModeText variant="caption" tone="secondary" numberOfLines={1}>
                    {summaryStatus.title}
                  </ModeText>
                </View>
              </View>
            ) : (
              <>
                <View style={styles.summaryHeaderRow}>
                  <ModeText variant="label" tone="tertiary" style={styles.summaryHeaderLabel}>
                    {plannerDayLabel}{plannerDateLabel ? ` · ${plannerDateLabel}` : ''}
                  </ModeText>
                </View>
                <ModeText testID="trainer-clients-summary-status-title" variant="bodySm" style={styles.summaryStatusTitle}>
                  {summaryStatus.title}
                </ModeText>
                <ModeText
                  testID="trainer-clients-summary-status-subtitle"
                  variant="caption"
                  tone="secondary"
                  style={styles.summaryStatusSubtitle}
                >
                  {summaryStatus.subtitle}
                </ModeText>
                <ModeText variant="bodySm">
                  {totals.assigned_clients} assigned clients · {totals.scheduled_today} scheduled {plannerDayLabel.toLowerCase()}
                </ModeText>
                <ModeText variant="bodySm" tone="secondary">
                  {totals.checkins_completed_today} check-ins completed {plannerDayLabel.toLowerCase()} · {totals.high_priority_clients} high-priority
                </ModeText>
                <ModeText variant="bodySm" tone="secondary">
                  {totals.critical_priority_clients} critical priority
                </ModeText>
              </>
            )}
          </ModeCard>
        </Pressable>

        {shouldShowDraftReviewCard ? (
          <ModeCard
            variant="surface"
            testID="trainer-clients-draft-review-card"
            style={[styles.draftReviewCard, styles.actionsTierCard]}
          >
            <View style={styles.draftReviewHeader}>
              <View>
                <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>Draft Review Queue</ModeText>
                <ModeText variant="bodySm">{draftQueueCount} pending</ModeText>
              </View>
              <View style={styles.draftReviewTrackerSummary}>
                {draftReviewGoalDenominator > 0 ? (
                  <ModeText
                    testID="trainer-clients-draft-review-daily-count"
                    variant="bodySm"
                    tone="accent"
                    style={styles.draftReviewTrackerValue}
                  >
                    {draftReviewDisplayDailyCount} / {draftReviewGoalDenominator} today
                  </ModeText>
                ) : null}
                <ModeText
                  testID="trainer-clients-draft-review-lifetime-count"
                  variant="caption"
                  tone="secondary"
                >
                  {draftReviewLifetimeCount} total
                </ModeText>
              </View>
            </View>

            <ProgressBar
              testID="trainer-clients-draft-review-progress"
              progress={draftReviewDailyProgress}
              trackColor={theme.colors.surface.base}
              fillColor={theme.colors.accent.primary}
              style={styles.draftReviewProgress}
            />

            {isLoadingDraftReviewTracker ? (
              <ModeText variant="caption" tone="secondary">Loading review tracker...</ModeText>
            ) : null}

            {isLoadingDraftQueue ? (
              <View style={styles.draftReviewLoadingRow}>
                <ActivityIndicator size="small" color={theme.colors.accent.primary} />
                <ModeText variant="caption" tone="secondary">Loading draft queue...</ModeText>
              </View>
            ) : null}

            {!isLoadingDraftQueue && draftQueueError ? (
              <View style={styles.draftReviewMessageBlock}>
                <ModeText variant="bodySm" tone="error">{draftQueueError.message}</ModeText>
                <ModeButton
                  title="Retry Queue"
                  size="sm"
                  variant="secondary"
                  onPress={() => loadDraftQueue()}
                />
              </View>
            ) : null}

            {!isLoadingDraftQueue && !draftQueueError && draftQueueCount > 0 && !activeDraft ? (
              <View style={styles.draftReviewMessageBlock}>
                <ModeText variant="bodySm" tone="secondary">
                  Great pass complete. Start from top to run another review loop.
                </ModeText>
                <ModeButton
                  testID="trainer-clients-draft-review-start-over"
                  title="Start From Top"
                  size="sm"
                  variant="secondary"
                  onPress={handleStartDraftQueueFromTop}
                />
              </View>
            ) : null}

            {!isLoadingDraftQueue && !draftQueueError && activeDraft ? (
              <View style={styles.draftReviewBody}>
                <ModeText variant="caption" tone="tertiary">Structured Draft Review</ModeText>
                <ModeText
                  testID="trainer-clients-draft-review-active-title"
                  variant="bodySm"
                  style={styles.draftReviewDraftTitle}
                >
                  {activeDraftModel?.title || activeDraft.headline || activeDraft.summary || 'Untitled draft'}
                </ModeText>
                <ModeText variant="caption" tone="secondary">
                  {activeDraft.client_name || 'Client'} · {activeDraft.priority_tier || 'normal'} priority · {activeDraft.action_type || activeDraft.source_type}
                </ModeText>
                {activeDraftPosition ? (
                  <ModeText variant="caption" tone="tertiary">
                    Reviewing {activeDraftPosition} of {draftQueueCount}
                  </ModeText>
                ) : null}

                <DraftReviewStructuredCard
                  model={activeDraftModel}
                  modelKey={activeDraft.output_id}
                  onModelChange={setActiveDraftModel}
                  onRetryRender={handleRetryDraftRender}
                  onRegeneratePlan={handleRegenerateDraft}
                  testIDPrefix="trainer-clients-draft-review"
                />

                <View style={styles.draftReviewActionRow}>
                  <ModeButton
                    testID="trainer-clients-draft-review-reject"
                    title={isMutatingDraftReview ? 'Working...' : 'Reject'}
                    size="sm"
                    variant="destructive"
                    disabled={isMutatingDraftReview}
                    onPress={() => runDraftReviewMutation(DRAFT_REVIEW_ACTION_TYPE.REJECT)}
                    style={styles.draftReviewActionButton}
                  />
                  <ModeButton
                    testID="trainer-clients-draft-review-approve"
                    title={isMutatingDraftReview ? 'Working...' : 'Approve'}
                    size="sm"
                    disabled={isMutatingDraftReview}
                    onPress={() => runDraftReviewMutation(DRAFT_REVIEW_ACTION_TYPE.APPROVE)}
                    style={styles.draftReviewActionButton}
                  />
                </View>
              </View>
            ) : null}

            {draftReviewMutationError ? (
              <ModeText variant="caption" tone="error">{draftReviewMutationError}</ModeText>
            ) : null}
            {draftReviewMutationSuccess ? (
              <ModeText variant="caption" tone="secondary">{draftReviewMutationSuccess}</ModeText>
            ) : null}
          </ModeCard>
        ) : null}

        <FilterBar
          dayLabel={selectedDayConfig.label}
          sessionLabel={selectedSessionConfig.label}
          priorityLabel={selectedPriorityConfig.label}
          onPressDay={openDayFilterSheet}
          onPressSession={openSessionFilterSheet}
          onPressPriority={openPriorityFilterSheet}
          isDayCustom={dayFilter !== DEFAULT_DAY_FILTER}
          isSessionCustom={sessionFilter !== DEFAULT_SESSION_FILTER}
          isPriorityCustom={priorityFilter !== DEFAULT_PRIORITY_FILTER}
        />

        {!breathingTransitionsEnabled && isLoadingCommandCenter ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={theme.colors.accent.primary} />
            <ModeText variant="bodySm" tone="secondary">Loading Command Center...</ModeText>
          </View>
        ) : null}

        {!isLoadingCommandCenter && commandCenterError ? (
          <ModeCard variant="surface">
            <ModeText variant="bodySm" tone="error">{commandCenterError.message}</ModeText>
            {commandCenterError.isStaleBackendRoute ? (
              <View style={styles.routeDiagnosticBlock}>
                <ModeText variant="bodySm" tone="secondary">
                  The backend appears stale and is missing Trainer Command Center routes.
                </ModeText>
                {commandCenterError.requestPath ? (
                  <ModeText variant="caption" tone="tertiary">
                    Missing route: {commandCenterError.requestPath}
                  </ModeText>
                ) : null}
                {commandCenterError.apiBase ? (
                  <ModeText variant="caption" tone="tertiary">
                    API base: {commandCenterError.apiBase}
                  </ModeText>
                ) : null}
                <ModeText variant="caption" tone="tertiary">
                  Restart or redeploy backend from current repo code, then verify `/openapi.json`.
                </ModeText>
              </View>
            ) : null}
            <ModeButton
              title="Retry"
              variant="secondary"
              onPress={() => handleRefreshCommandCenter()}
              style={styles.actionButton}
            />
          </ModeCard>
        ) : null}

        {!isLoadingCommandCenter && hasLoadedCommandCenter && !commandCenterError && visibleClientItems.length === 0 ? (
          <ModeCard variant="surface">
            <ModeText variant="bodySm" tone="secondary">
              No clients match the selected filter.
            </ModeText>
          </ModeCard>
        ) : null}

          </>
        )}
        ItemSeparatorComponent={CommandCenterClientSeparator}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        updateCellsBatchingPeriod={50}
        windowSize={7}
        removeClippedSubviews={Platform.OS !== 'web'}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      />
      {breathingTransitionsEnabled ? (
        <BreathingTransitionOverlay
          active={isLoadingCommandCenter}
          context={BREATHING_CONTEXT.CLIENT_CONTEXT_LOAD}
          variant="overlay"
          progressLabel="Loading Command Center..."
          testID="trainer-clients-command-center-breathing-loader"
        />
      ) : null}
      <FilterBottomSheet
        visible={Boolean(activeFilterSheetConfig)}
        title={activeFilterSheetConfig?.title || ''}
        options={activeFilterSheetConfig?.options || []}
        selectedKey={activeFilterSheetConfig?.selectedKey || ''}
        onSelect={activeFilterSheetConfig?.onSelect}
        onClose={closeFilterSheet}
        showReset={hasCustomFilters}
        onReset={resetFilters}
        bottomInset={insets.bottom}
      />
    </SafeScreen>
  );
}

function CommandCenterClientSeparator() {
  return <View style={styles.clientListSeparator} />;
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: theme.colors.background.app,
  },
  content: {
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[3],
    gap: theme.spacing[2],
  },
  sectionLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.72,
    marginBottom: theme.spacing[1],
  },
  loadingContainer: {
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[2],
  },
  routeDiagnosticBlock: {
    marginTop: theme.spacing[2],
    gap: theme.spacing[1] - 2,
  },
  actionButton: {
    marginTop: theme.spacing[2],
  },
  heroTierCard: {
    shadowColor: theme.colors.accent.primary,
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  summaryStatusTitle: {
    fontWeight: '700',
  },
  summaryStatusSubtitle: {
    marginTop: 2,
  },
  summaryHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  summaryHeaderLabel: {
    marginBottom: 0,
  },
  summaryCollapsedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[2],
  },
  summaryCollapsedCopy: {
    flex: 1,
    gap: 2,
  },
  summaryCollapsedLabel: {
    marginBottom: 0,
  },
  summaryTogglePressed: {
    opacity: theme.interaction.pressedOpacity,
  },
  actionsTierCard: {
    paddingTop: theme.spacing[1],
  },
  draftReviewCard: {
    gap: theme.spacing[2],
  },
  draftReviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: theme.spacing[2],
  },
  draftReviewTrackerSummary: {
    alignItems: 'flex-end',
    gap: 2,
  },
  draftReviewTrackerValue: {
    fontWeight: '700',
  },
  draftReviewProgress: {
    marginTop: theme.spacing[1] - 2,
    marginBottom: theme.spacing[1] - 2,
  },
  draftReviewLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[1],
  },
  draftReviewMessageBlock: {
    gap: theme.spacing[1],
  },
  draftReviewBody: {
    marginTop: theme.spacing[1] - 2,
    gap: theme.spacing[2],
  },
  draftReviewDraftTitle: {
    fontWeight: '700',
  },
  draftReviewInput: {
    minHeight: 96,
  },
  draftReviewActionRow: {
    flexDirection: 'row',
    gap: theme.spacing[1],
  },
  draftReviewActionButton: {
    flex: 1,
  },
  clientListSeparator: {
    height: theme.spacing[2],
  },
  clientOperationalCard: {
    marginBottom: 0,
  },
  clientHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[2],
  },
  clientName: {
    flex: 1,
  },
  priorityBadge: {
    borderWidth: 1,
    borderRadius: theme.radii.pill,
    paddingHorizontal: theme.spacing[1],
    paddingVertical: 2,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[1],
  },
  summaryHeaderActions: {
    marginTop: theme.spacing[1],
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing[2],
  },
  summaryTextBlock: {
    flex: 1,
    gap: theme.spacing[1],
    marginTop: theme.spacing[1] - 2,
  },
  coachingBriefBlock: {
    gap: theme.spacing[1] - 2,
  },
  coachingBriefList: {
    gap: theme.spacing[1] - 2,
  },
  coachingBriefBullet: {
    lineHeight: theme.typography.body2.lineHeight + 2,
  },
  questionSignalsBlock: {
    gap: theme.spacing[1] - 2,
  },
  questionSignalsLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.56,
  },
  questionSignalChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[1],
  },
  questionSignalChip: {
    minWidth: 82,
    borderWidth: 1,
    borderRadius: theme.radii.m,
    paddingHorizontal: theme.spacing[1],
    paddingVertical: 5,
    gap: 1,
  },
  questionSignalLabel: {
    fontWeight: '600',
  },
  questionSignalValue: {
    fontWeight: '700',
  },
  supportingSignalBlock: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.glass.borderSoft,
    paddingTop: theme.spacing[2],
    gap: 2,
  },
  supportingMetaLine: {
    lineHeight: theme.typography.body3.lineHeight + 1,
  },
  readinessNarrativeBlock: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.glass.borderSoft,
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[1],
  },
  readinessNarrativeText: {
    lineHeight: theme.typography.body2.lineHeight + 2,
  },
  summaryActionStack: {
    alignItems: 'flex-end',
    gap: theme.spacing[1],
  },
  summaryHeadline: {
    fontWeight: '700',
  },
  summaryHero: {
    fontWeight: '700',
  },
  saveHeaderAction: {
    width: 88,
  },
  iconActionButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.glass.borderSoft,
    backgroundColor: theme.colors.glass.base,
  },
  iconActionButtonPressed: {
    opacity: theme.interaction.pressedOpacity,
    transform: [{ scale: theme.interaction.pressedScale }],
  },
  quickEditRowSurface: {
    marginTop: theme.spacing[1],
  },
  quickEditRowContent: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  quickEditRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[2],
  },
  quickEditCopy: {
    flex: 1,
    gap: 2,
  },
  templateEditor: {
    marginTop: theme.spacing[1],
    gap: theme.spacing[1],
    borderRadius: theme.radii.m,
    borderWidth: 1,
    borderColor: theme.colors.glass.borderSoft,
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    padding: theme.spacing[2],
  },
  weekdayChipRowCompact: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[1],
  },
  templateToggleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[1],
  },
  scheduleSheetRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  scheduleSheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(6, 12, 22, 0.5)',
  },
  scheduleSheet: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderBottomWidth: 0,
  },
  scheduleSheetContent: {
    paddingTop: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[3],
    gap: theme.spacing[1],
  },
  scheduleSheetGrabber: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 999,
    backgroundColor: theme.colors.glass.borderStrong,
    marginBottom: theme.spacing[1],
  },
  scheduleSheetTitle: {
    marginBottom: theme.spacing[1],
  },
  metaLine: {
    marginTop: theme.spacing[1],
  },
  scheduleEditorBlock: {
    marginTop: theme.spacing[2],
    gap: theme.spacing[1],
    borderRadius: theme.radii.l,
    borderWidth: 1,
    borderColor: theme.colors.glass.borderSoft,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    padding: theme.spacing[2],
  },
  weekdayChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[1],
    marginTop: theme.spacing[1] - 2,
  },
  inlineChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[1],
    marginTop: theme.spacing[1] - 2,
    marginBottom: theme.spacing[1] - 2,
  },
  scheduleActionRow: {
    flexDirection: 'row',
    gap: theme.spacing[1],
    marginTop: theme.spacing[1],
  },
  scheduleActionButton: {
    flex: 1,
  },
  scheduleExceptionList: {
    marginTop: theme.spacing[1],
    gap: theme.spacing[1] - 4,
  },
  riskFlagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[1],
    marginTop: theme.spacing[2],
  },
  riskFlagRowCompact: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[1],
    marginTop: theme.spacing[1],
  },
  riskChipHigh: {
    borderColor: theme.colors.feedback.errorBorder,
    backgroundColor: theme.colors.feedback.errorBg,
  },
  riskChipMedium: {
    borderColor: theme.colors.feedback.warningBorder,
    backgroundColor: theme.colors.feedback.warningBg,
  },
  riskChipLow: {
    borderColor: theme.colors.border.default,
    backgroundColor: theme.colors.surface.elevated,
  },
  summaryBlock: {
    marginTop: theme.spacing[2],
    gap: theme.spacing[1],
    borderTopWidth: 1,
    borderTopColor: theme.colors.glass.borderSoft,
    paddingTop: theme.spacing[2],
  },
  pointsList: {
    gap: theme.spacing[1] - 2,
  },
  cacheMeta: {
    marginTop: theme.spacing[1] - 2,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[1],
    marginTop: theme.spacing[1],
  },
  memoryInput: {
    marginTop: theme.spacing[1],
  },
  questionSignalDetailCard: {
    marginBottom: theme.spacing[1],
  },
  questionSignalWindowLabel: {
    marginTop: -theme.spacing[1],
    marginBottom: theme.spacing[1],
  },
  questionSignalDetailList: {
    gap: theme.spacing[2],
  },
  questionSignalDetailRow: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.glass.borderSoft,
    paddingTop: theme.spacing[2],
    gap: theme.spacing[1],
  },
  questionSignalDetailHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: theme.spacing[2],
  },
  questionSignalDetailTitle: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  questionSignalDetailName: {
    fontWeight: '700',
  },
  questionSignalStatusBadge: {
    borderWidth: 1,
    borderRadius: theme.radii.m,
    paddingHorizontal: theme.spacing[1],
    paddingVertical: 4,
    maxWidth: 150,
  },
  questionSignalStatusText: {
    fontWeight: '700',
  },
  questionSignalDayRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  questionSignalDayPill: {
    minWidth: 44,
    borderRadius: theme.radii.s,
    borderWidth: 1,
    borderColor: theme.colors.glass.borderSoft,
    backgroundColor: theme.colors.glass.base,
    paddingHorizontal: 6,
    paddingVertical: 4,
    alignItems: 'center',
    gap: 1,
  },
  questionSignalDayDate: {
    fontSize: 10,
  },
  questionSignalDayScore: {
    fontWeight: '700',
  },
  questionSignalPrompt: {
    lineHeight: theme.typography.body2.lineHeight + 2,
  },
  memoryHubCard: {
    marginBottom: theme.spacing[1],
  },
  memorySectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[2],
    marginBottom: theme.spacing[1] - 2,
  },
  memorySectionLabel: {
    marginBottom: 0,
    letterSpacing: 0.56,
  },
  memoryToggleRow: {
    marginTop: theme.spacing[1] - 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[1],
  },
  memoryTagsAction: {
    marginTop: theme.spacing[1] - 2,
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  memoryTagsActionPressed: {
    opacity: theme.interaction.pressedOpacity,
  },
  memoryTagsActionText: {
    textDecorationLine: 'underline',
    textDecorationColor: theme.colors.text.secondary,
  },
  memorySaveButton: {
    marginTop: theme.spacing[1] - 2,
  },
  memoryInlineFeedback: {
    marginTop: theme.spacing[1] - 4,
  },
  memoryDenseList: {
    marginTop: theme.spacing[1],
    borderTopWidth: 1,
    borderTopColor: theme.colors.glass.borderSoft,
  },
  memoryDenseRow: {
    minHeight: 56,
    paddingVertical: theme.spacing[1] - 2,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.glass.borderSoft,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[1],
  },
  memoryDenseRowPressed: {
    opacity: theme.interaction.pressedOpacity,
  },
  memoryDenseRowMain: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  memoryDenseRowText: {
    lineHeight: theme.typography.body2.lineHeight,
  },
  memoryDenseRowMeta: {
    lineHeight: theme.typography.body3.lineHeight,
  },
  memoryDenseRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[1],
  },
  memoryStatusBadge: {
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    minWidth: 52,
    alignItems: 'center',
  },
  memoryStatusBadgeAi: {
    backgroundColor: theme.colors.nav.activeBg,
    borderColor: theme.colors.nav.activeBorder,
  },
  memoryStatusBadgeInternal: {
    backgroundColor: theme.colors.surface.elevated,
    borderColor: theme.colors.glass.borderSoft,
  },
  memoryStatusBadgeText: {
    fontWeight: '700',
  },
  memoryIconActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  memoryRowIconButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: theme.colors.glass.borderSoft,
    backgroundColor: theme.colors.glass.base,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memoryRowIconButtonPressed: {
    opacity: theme.interaction.pressedOpacity,
    transform: [{ scale: theme.interaction.pressedScale }],
  },
  clientContextCard: {
    marginBottom: theme.spacing[1],
  },
  clientContextToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[2],
  },
  clientContextTogglePressed: {
    opacity: theme.interaction.pressedOpacity,
  },
  clientContextToggleCopy: {
    flex: 1,
    gap: 2,
  },
  clientContextExpanded: {
    marginTop: theme.spacing[1],
    gap: theme.spacing[1],
    borderTopWidth: 1,
    borderTopColor: theme.colors.glass.borderSoft,
    paddingTop: theme.spacing[1],
  },
  clientContextGroup: {
    gap: 2,
  },
  clientContextActionButton: {
    marginTop: theme.spacing[1] - 4,
  },
  scheduleExceptionListCompact: {
    marginTop: 2,
    gap: 2,
  },
  memoryEditSheetRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  memoryEditSheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(6, 12, 22, 0.5)',
  },
  memoryEditSheet: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderBottomWidth: 0,
  },
  memoryEditSheetContent: {
    paddingTop: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[3],
    gap: theme.spacing[1],
  },
  memoryEditSheetGrabber: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 999,
    backgroundColor: theme.colors.glass.borderStrong,
    marginBottom: theme.spacing[1],
  },
  memoryEditSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[2],
  },
  memoryEditSheetCopy: {
    flex: 1,
    gap: 2,
  },
  memoryEditSheetLabel: {
    marginBottom: 0,
  },
  memoryEditSheetActionRow: {
    flexDirection: 'row',
    gap: theme.spacing[1],
    marginTop: theme.spacing[1] - 2,
  },
  memoryEditSheetActionButton: {
    flex: 1,
  },
  aiContextMeta: {
    marginTop: theme.spacing[1],
  },
  aiContextSection: {
    marginTop: theme.spacing[2],
    gap: theme.spacing[1] - 2,
  },
});

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';

import {
  HeaderBar,
  ModeButton,
  ModeCard,
  ModeText,
  ProgressBar,
  SafeScreen,
} from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import { SHOW_DEV_CONNECTION_DEBUG } from '../../../config/featureFlags';
import { getApiDebugInfo } from '../../../services/apiBaseUrl';
import { getApiRequestDebugState } from '../../../services/apiRequest';
import {
  generateCheckinPlan,
  getPreviousCheckin,
  getTodayCheckin,
  logGeneratedWorkout,
  probeBackendHealthz,
  probeTodayCheckin,
  submitTodayCheckin,
} from '../services/checkinApi';

const QUESTIONS = [
  {
    id: 'sleep',
    key: 'sleep',
    icon: { family: 'material', name: 'weather-night' },
    question: 'How well did you sleep?',
    subtitle: 'Quality rest is the foundation of performance',
    color: '#6F8F7B',
    options: [
      { score: 1, label: 'Barely slept', sublabel: 'Under 4 hours' },
      { score: 2, label: 'Poor sleep', sublabel: 'Restless night' },
      { score: 3, label: 'OK sleep', sublabel: 'Some interruptions' },
      { score: 4, label: 'Good sleep', sublabel: 'Mostly rested' },
      { score: 5, label: 'Great sleep', sublabel: 'Fully recharged' },
    ],
  },
  {
    id: 'stress',
    key: 'stress',
    icon: { family: 'feather', name: 'wind' },
    question: 'How heavy is your stress today?',
    subtitle: 'Calm systems recover and perform better',
    color: '#4CAF7D',
    options: [
      { score: 1, label: 'Maxed out', sublabel: 'I feel overloaded' },
      { score: 2, label: 'High stress', sublabel: 'Hard to settle' },
      { score: 3, label: 'Manageable', sublabel: 'I am holding it together' },
      { score: 4, label: 'Mostly calm', sublabel: 'A few stressors, still steady' },
      { score: 5, label: 'Very calm', sublabel: 'Clear head, low friction' },
    ],
  },
  {
    id: 'soreness',
    key: 'soreness',
    icon: { family: 'material', name: 'arm-flex' },
    question: 'How is your body feeling?',
    subtitle: 'Soreness changes how hard you should push',
    color: '#A8C1B3',
    options: [
      { score: 1, label: 'Very sore', sublabel: 'Movement feels heavy' },
      { score: 2, label: 'Pretty sore', sublabel: 'A lot of stiffness today' },
      { score: 3, label: 'Some soreness', sublabel: 'Noticeable but manageable' },
      { score: 4, label: 'Minor soreness', sublabel: 'Just a little tight' },
      { score: 5, label: 'Fresh body', sublabel: 'Ready to move well' },
    ],
  },
  {
    id: 'nutrition',
    key: 'nutrition',
    icon: { family: 'material', name: 'food-apple-outline' },
    question: 'How well have you fueled yourself?',
    subtitle: 'Nutrition sets the ceiling for recovery and output',
    color: '#6F8F7B',
    options: [
      { score: 1, label: 'Way off', sublabel: 'Little structure today' },
      { score: 2, label: 'Below target', sublabel: 'Missed a lot of basics' },
      { score: 3, label: 'Decent enough', sublabel: 'Some good choices, some misses' },
      { score: 4, label: 'Solid nutrition', sublabel: 'Mostly on plan' },
      { score: 5, label: 'Locked in', sublabel: 'Fully fueled and intentional' },
    ],
  },
  {
    id: 'motivation',
    key: 'motivation',
    icon: { family: 'feather', name: 'zap' },
    question: 'How motivated do you feel?',
    subtitle: 'Honest effort starts with honest readiness',
    color: '#1F3D36',
    options: [
      { score: 1, label: 'Running on empty', sublabel: 'I do not want to do this' },
      { score: 2, label: 'Low motivation', sublabel: 'Willpower feels thin' },
      { score: 3, label: 'I can show up', sublabel: 'Not fired up, still capable' },
      { score: 4, label: 'Ready to work', sublabel: 'Good focus and intent' },
      { score: 5, label: 'All in', sublabel: 'I want to attack the day' },
    ],
  },
];

const MODE_THEME = {
  BEAST: {
    accent: '#1F3D36',
    badge: 'Overdrive readiness',
  },
  BUILD: {
    accent: '#4CAF7D',
    badge: 'Build momentum',
  },
  RECOVER: {
    accent: '#6F8F7B',
    badge: 'Base recovery',
  },
  REST: {
    accent: '#6F8F7B',
    badge: 'Reset support',
  },
};

const MODE_RECOMMENDATIONS = {
  BEAST: {
    training: {
      type: 'Strength or HIIT',
      duration: '45-60 min',
      intensity: 'High',
    },
    nutrition: {
      rule: 'Fuel hard with protein and performance carbs.',
    },
    mindset: {
      cue: 'Attack the day. You are cleared to push.',
    },
    mode_tagline: 'Full-send readiness with permission to push the pace.',
  },
  BUILD: {
    training: {
      type: 'Moderate cardio or controlled strength',
      duration: '30-45 min',
      intensity: 'Moderate',
    },
    nutrition: {
      rule: 'Keep meals balanced and steady all day.',
    },
    mindset: {
      cue: 'Build momentum with disciplined reps.',
    },
    mode_tagline: 'Stable readiness for strong, intentional work.',
  },
  RECOVER: {
    training: {
      type: 'Light movement or recovery',
      duration: '20-30 min',
      intensity: 'Low',
    },
    nutrition: {
      rule: 'Hydrate well and lean on whole foods.',
    },
    mindset: {
      cue: 'Recovery done well is progress.',
    },
    mode_tagline: 'A recovery-leaning day that still rewards smart action.',
  },
  REST: {
    training: {
      type: 'Mobility, walking, or full restorative movement',
      duration: '10-20 min',
      intensity: 'Very low',
    },
    nutrition: {
      rule: 'Keep it simple: fluids, protein, and micronutrients.',
    },
    mindset: {
      cue: 'Rest with intent so you can return stronger.',
    },
    mode_tagline: 'Restore the system and protect tomorrow\'s ceiling.',
  },
};

const MODE_GUIDE_DETAILS = {
  REST: 'REST days protect your long-term progress. Use low-pressure movement, mobility, and recovery support.',
  RECOVER: 'RECOVER keeps momentum without overload. Choose moderate work and stabilize your routines.',
  BUILD: 'BUILD converts consistency into growth. Progress with focused training and supportive nutrition.',
  BEAST: 'BEAST is intentional high-output mode. Use high effort selectively when readiness is truly strong.',
};

const INPUT_EXPLAINER_FIELDS = [
  { key: 'sleep', label: 'Sleep' },
  { key: 'stress', label: 'Stress' },
  { key: 'soreness', label: 'Soreness' },
  { key: 'nutrition', label: 'Nutrition' },
  { key: 'motivation', label: 'Motivation' },
];

const SCORE_KEYS = QUESTIONS.map((question) => question.key);
const GRID_COLUMNS = 18;
const GRID_ROWS = 10;
const PLAN_TYPE = {
  TRAINING: 'training',
  NUTRITION: 'nutrition',
};
const COACH_BY_MODE = {
  BEAST: 'Rex',
  BUILD: 'Alex',
  RECOVER: 'Maya',
  REST: 'Zen',
};
const TIME_OPTIONS = [10, 30, 45, 60];
const ENVIRONMENT_OPTIONS = [
  {
    value: 'full_gym',
    emoji: '🏋️',
    label: 'Full Gym',
    description: 'Barbells, racks, machines',
  },
  {
    value: 'home_gym',
    emoji: '🏠',
    label: 'Home Gym',
    description: 'Your setup at home',
  },
  {
    value: 'hotel_room',
    emoji: '🏨',
    label: 'Hotel Room',
    description: 'Minimal equipment',
  },
  {
    value: 'outdoors',
    emoji: '🌳',
    label: 'Outdoors',
    description: 'Track, trail, park',
  },
  {
    value: 'bodyweight',
    emoji: '🤸',
    label: 'Bodyweight',
    description: 'No equipment needed',
  },
  {
    value: 'limited',
    emoji: '⏱️',
    label: 'Limited',
    description: 'Tight setup today',
  },
];

function getLocalDateString() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function formatTodayLabel(dateString) {
  const parsed = new Date(`${dateString}T12:00:00`);
  return parsed.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

function createEmptyAnswers() {
  return {
    sleep: 0,
    stress: 0,
    soreness: 0,
    nutrition: 0,
    motivation: 0,
  };
}

function calculateTotalScore(inputs) {
  return SCORE_KEYS.reduce((total, key) => total + (inputs[key] || 0), 0);
}

function assignMode(score) {
  if (score >= 21) {
    return 'BEAST';
  }
  if (score >= 16) {
    return 'BUILD';
  }
  if (score >= 11) {
    return 'RECOVER';
  }
  return 'REST';
}

function buildFallbackResult({ date, inputs, timeToComplete }) {
  const score = calculateTotalScore(inputs);
  const mode = assignMode(score);

  return {
    id: `local-${date}`,
    date,
    score,
    mode,
    inputs,
    ...MODE_RECOMMENDATIONS[mode],
    time_to_complete: timeToComplete,
    completion_timestamp: new Date().toISOString(),
  };
}

function logSubmitFailure({ date, inputs, error }) {
  const score = calculateTotalScore(inputs);
  const mode = assignMode(score);

  console.error('Daily check-in submit failed', {
    date,
    score,
    mode,
    status: error?.status ?? null,
    detail: error?.detail ?? error?.message ?? null,
    message: error?.message ?? 'Unknown error',
  });
}

function withFallback(value) {
  if (value === null || value === undefined || value === '') {
    return 'unknown';
  }

  return String(value);
}

function buildSupportBundle({ date, result, submitError }) {
  return [
    'MODE Check-in Support Bundle',
    `Date: ${withFallback(date)}`,
    'Save status: pending',
    `HTTP status: ${withFallback(submitError?.status)}`,
    `Detail: ${withFallback(submitError?.detail)}`,
    `Message: ${withFallback(submitError?.message)}`,
    `Mode: ${withFallback(result?.mode)}`,
    `Score: ${withFallback(result?.score)}/25`,
    `Training: ${withFallback(result?.training?.type)} | ${withFallback(result?.training?.duration)} | ${withFallback(result?.training?.intensity)}`,
    `Nutrition: ${withFallback(result?.nutrition?.rule)}`,
    `Mindset: ${withFallback(result?.mindset?.cue)}`,
  ].join('\n');
}

function getInputAnswerLabel(key, score) {
  const question = QUESTIONS.find((item) => item.key === key);
  const option = question?.options?.find((item) => item.score === score);
  return option?.label || 'Not answered';
}

function buildPlanDiagnosticsLine(planError) {
  if (!planError) {
    return null;
  }

  const chips = [];
  if (planError?.status) {
    chips.push(`HTTP ${planError.status}`);
  }
  if (planError?.code) {
    chips.push(`code ${planError.code}`);
  }
  if (planError?.request_id) {
    chips.push(`request ${planError.request_id}`);
  }
  if (planError?.stage === 'network' && planError?.resolved_api_base_url) {
    chips.push(`api ${planError.resolved_api_base_url}`);
  }

  return chips.length > 0 ? chips.join(' • ') : null;
}

function buildPlanSupportBundle({
  date,
  planType,
  checkinId,
  environment,
  timeAvailable,
  nutritionDayType,
  nutritionDayNote,
  includeYesterdayContext,
  planError,
}) {
  return [
    'MODE Plan Generation Diagnostics',
    `Date: ${withFallback(date)}`,
    `Plan type: ${withFallback(planType)}`,
    `Check-in ID: ${withFallback(checkinId)}`,
    `Environment: ${withFallback(environment)}`,
    `Time available: ${withFallback(timeAvailable)}`,
    `Nutrition day type: ${withFallback(nutritionDayType)}`,
    `Nutrition day note: ${withFallback(nutritionDayNote)}`,
    `Use yesterday context: ${withFallback(includeYesterdayContext)}`,
    `Path: ${withFallback(planError?.path)}`,
    `Stage: ${withFallback(planError?.stage)}`,
    `HTTP status: ${withFallback(planError?.status)}`,
    `Code: ${withFallback(planError?.code)}`,
    `Request ID: ${withFallback(planError?.request_id)}`,
    `Resolved API base URL: ${withFallback(planError?.resolved_api_base_url)}`,
    `Attempted API hosts: ${withFallback(Array.isArray(planError?.attempted_base_urls) ? planError.attempted_base_urls.join(', ') : null)}`,
    `Last successful API host: ${withFallback(planError?.last_successful_base_url)}`,
    `Raw network error: ${withFallback(planError?.raw_error_message)}`,
    `Detail: ${withFallback(planError?.detail)}`,
    `Hint: ${withFallback(planError?.hint)}`,
    `Message: ${withFallback(planError?.message)}`,
  ].join('\n');
}

function buildConnectionDebugSnapshot(overrides = {}) {
  const apiDebug = getApiDebugInfo();
  const requestDebug = getApiRequestDebugState();

  return {
    configuredApiBaseUrl: apiDebug.configuredApiBaseUrl,
    preferredApiBaseUrl: apiDebug.preferredApiBaseUrl,
    resolvedApiBaseUrl: apiDebug.resolvedApiBaseUrl,
    candidateApiBaseUrls: apiDebug.candidateApiBaseUrls,
    suppressLoopbackFallbacks: apiDebug.suppressLoopbackFallbacks,
    isPhysicalDevice: apiDebug.isPhysicalDevice,
    lastSuccessfulBaseUrl: requestDebug.lastSuccessfulBaseUrl,
    lastAttemptedBaseUrls: requestDebug.lastAttemptedBaseUrls,
    lastRequestPath: requestDebug.lastPath,
    lastRequestErrorMessage: requestDebug.lastErrorMessage,
    updatedAt: new Date().toISOString(),
    lastProbe: null,
    ...overrides,
  };
}

function buildProbeSummary(probe) {
  if (!probe) {
    return 'No probe run yet.';
  }

  const parts = [
    probe.label || probe.type || 'probe',
    probe.status || 'unknown',
  ];
  if (probe.httpStatus) {
    parts.push(`HTTP ${probe.httpStatus}`);
  }
  if (probe.baseUrl) {
    parts.push(probe.baseUrl);
  }
  if (probe.message) {
    parts.push(probe.message);
  }
  return parts.join(' • ');
}

function ConnectionDebugCard({
  debugState,
  isHealthzProbeRunning,
  isTodayProbeRunning,
  onProbeHealthz,
  onProbeToday,
  visible = true,
}) {
  if (!visible) {
    return null;
  }

  return (
    <View style={styles.debugCard}>
      <Text style={styles.debugCardTitle}>Dev Connection Debug</Text>
      <Text style={styles.debugCardBody}>Configured API: {withFallback(debugState?.configuredApiBaseUrl)}</Text>
      <Text style={styles.debugCardBody}>Resolved API: {withFallback(debugState?.resolvedApiBaseUrl)}</Text>
      <Text style={styles.debugCardBody}>Preferred API: {withFallback(debugState?.preferredApiBaseUrl)}</Text>
      <Text style={styles.debugCardBody}>Last success: {withFallback(debugState?.lastSuccessfulBaseUrl)}</Text>
      <Text style={styles.debugCardBody}>Candidates: {withFallback(Array.isArray(debugState?.candidateApiBaseUrls) ? debugState.candidateApiBaseUrls.join(', ') : null)}</Text>
      <Text style={styles.debugCardBody}>Last request path: {withFallback(debugState?.lastRequestPath)}</Text>
      <Text style={styles.debugCardBody}>Last request error: {withFallback(debugState?.lastRequestErrorMessage)}</Text>
      <Text style={styles.debugCardBody}>Loopback suppressed: {String(Boolean(debugState?.suppressLoopbackFallbacks))}</Text>
      <Text style={styles.debugCardBody}>Physical device: {String(Boolean(debugState?.isPhysicalDevice))}</Text>
      <Text style={styles.debugCardBody}>Last probe: {buildProbeSummary(debugState?.lastProbe)}</Text>
      <View style={styles.debugButtonRow}>
        <ModeButton
          title={isHealthzProbeRunning ? 'Healthz…' : 'Healthz Probe'}
          variant="secondary"
          onPress={onProbeHealthz}
          disabled={isHealthzProbeRunning || isTodayProbeRunning}
          style={styles.debugButton}
        />
        <ModeButton
          title={isTodayProbeRunning ? 'Check-in…' : 'Check-in Probe'}
          variant="secondary"
          onPress={onProbeToday}
          disabled={isHealthzProbeRunning || isTodayProbeRunning}
          style={styles.debugButton}
        />
      </View>
    </View>
  );
}

function withAlpha(hexColor, alpha) {
  const normalized = hexColor.replace('#', '');
  const value = normalized.length === 3
    ? normalized.split('').map((chunk) => chunk + chunk).join('')
    : normalized;

  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function renderQuestionIcon(icon, color, size = 22) {
  if (icon.family === 'material') {
    return <MaterialCommunityIcons name={icon.name} size={size} color={color} />;
  }

  return <Feather name={icon.name} size={size} color={color} />;
}

function createProgressWidth(index, questionIndex) {
  return index === questionIndex ? 28 : 8;
}

function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function getCoachName(mode) {
  return COACH_BY_MODE[mode] || 'Coach';
}

function buildWorkoutSummary(plan) {
  if (!plan || typeof plan !== 'object') {
    return null;
  }

  return {
    title: plan.title || null,
    description: plan.description || null,
    duration_minutes: plan.durationMinutes ?? null,
    difficulty: plan.difficulty || null,
    type: plan.type || null,
    warmup: Array.isArray(plan.warmup)
      ? plan.warmup.map((item) => ({
        name: item?.name || null,
        duration: item?.duration || null,
        description: item?.description || null,
      }))
      : [],
    exercises: Array.isArray(plan.exercises)
      ? plan.exercises.map((exercise) => ({
        name: exercise?.name || null,
        sets: exercise?.sets ?? null,
        reps: exercise?.reps || null,
        rest: exercise?.rest || null,
        muscle_group: exercise?.muscleGroup || null,
        description: exercise?.description || null,
        coach_tip: exercise?.coachTip || null,
      }))
      : [],
    cooldown: Array.isArray(plan.cooldown)
      ? plan.cooldown.map((item) => ({
        name: item?.name || null,
        duration: item?.duration || null,
        description: item?.description || null,
      }))
      : [],
    coach_note: plan.coachNote || null,
  };
}

function buildNutritionSummary(plan) {
  if (!plan || typeof plan !== 'object') {
    return null;
  }

  return {
    title: plan.title || null,
    coach_note: plan.coachNote || null,
    total_calories: plan.totalCalories ?? null,
    total_protein: plan.totalProtein ?? null,
    meals: Array.isArray(plan.meals)
      ? plan.meals.map((meal) => ({
        name: meal?.name || null,
        emoji: meal?.emoji || null,
        timing: meal?.timing || null,
        total_calories: meal?.totalCalories ?? null,
        total_protein: meal?.totalProtein ?? null,
        foods: Array.isArray(meal?.foods)
          ? meal.foods.map((food) => ({
            name: food?.name || null,
            amount: food?.amount || null,
            calories: food?.calories ?? null,
            protein: food?.protein ?? null,
          }))
          : [],
        notes: meal?.notes || null,
      }))
      : [],
  };
}

function buildWorkoutLaunchContext({
  result,
  date,
  workoutContext,
}) {
  return {
    entrypoint: 'generated_workout',
    checkin_context: {
      checkin_id: result?.id || null,
      checkin_date: result?.date || date,
      assigned_mode: result?.mode || null,
      checkin_score: result?.score ?? null,
    },
    workout_context: workoutContext || null,
  };
}

function buildNutritionLaunchContext({
  result,
  date,
  nutritionContext,
}) {
  return {
    entrypoint: 'generated_nutrition',
    checkin_context: {
      checkin_id: result?.id || null,
      checkin_date: result?.date || date,
      assigned_mode: result?.mode || null,
      checkin_score: result?.score ?? null,
    },
    nutrition_context: nutritionContext || null,
  };
}

function BackgroundGrid() {
  const dots = [];

  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let column = 0; column < GRID_COLUMNS; column += 1) {
      dots.push(
        <View
          key={`${row}-${column}`}
          style={[
            styles.gridDot,
            {
              left: `${(column / (GRID_COLUMNS - 1)) * 100}%`,
              top: `${(row / (GRID_ROWS - 1)) * 100}%`,
            },
          ]}
        />,
      );
    }
  }

  return (
    <View pointerEvents="none" style={styles.gridOverlay}>
      {dots}
    </View>
  );
}

function ResultCard({
  result,
  onBuildTraining,
  onBuildNutrition,
  showPlanActions,
}) {
  const modeTheme = MODE_THEME[result.mode] || MODE_THEME.RECOVER;

  return (
    <View style={[styles.resultCard, { borderColor: withAlpha(modeTheme.accent, 0.55) }]}>
      <View style={[styles.bundleBlock, styles.bundleBlockFirst]}>
        <Text style={styles.bundleLabel}>Training</Text>
        <Text style={styles.bundleValue}>{result.training.type}</Text>
        <Text style={styles.bundleMeta}>
          {result.training.duration} • {result.training.intensity}
        </Text>
        {showPlanActions ? (
          <PlanActionCard
            icon="dumbbell"
            title="Build me a training routine"
            subtitle={`Tailored to your ${result?.mode || 'BUILD'} mode today`}
            accent={theme.colors.brand.progressSuccess}
            onPress={onBuildTraining}
            style={styles.bundleActionCard}
          />
        ) : null}
      </View>

      <View style={styles.bundleBlock}>
        <Text style={styles.bundleLabel}>Nutrition</Text>
        <Text style={styles.bundleValue}>{result.nutrition.rule}</Text>
        {showPlanActions ? (
          <PlanActionCard
            icon="food-apple-outline"
            title="Build me a nutrition plan"
            subtitle="Meals optimized for your readiness"
            accent={theme.colors.brand.progressCore}
            onPress={onBuildNutrition}
            style={styles.bundleActionCard}
          />
        ) : null}
      </View>
    </View>
  );
}

function HomeOverviewCard({ result, isModeInfoOpen, onToggleModeInfo, onOpenInsights, onOpenCoachChat }) {
  if (!result) {
    return null;
  }

  const modeTheme = MODE_THEME[result.mode] || MODE_THEME.RECOVER;
  const scoreProgress = Math.max(0, Math.min(1, (result.score || 0) / 25));
  const modeGuideCopy = MODE_GUIDE_DETAILS[result.mode] || MODE_GUIDE_DETAILS.RECOVER;

  return (
    <ModeCard variant="surface" style={styles.homeOverviewCard}>
      <View style={styles.homeOverviewModeRow}>
        <ModeText variant="label" tone="tertiary" style={styles.homeOverviewModeLabel}>
          Today&apos;s mode
        </ModeText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Explain today's mode"
          accessibilityHint="Reveals how today's mode was determined from your check-in answers."
          onPress={onToggleModeInfo}
          hitSlop={10}
          style={({ pressed }) => [
            styles.homeOverviewInfoButton,
            pressed && styles.homeOverviewInfoButtonPressed,
          ]}
        >
          <Feather name="info" size={14} color={theme.colors.textMedium} />
        </Pressable>
      </View>
      <ModeText variant="display" style={[styles.homeOverviewModeValue, { color: modeTheme.accent }]}>
        {result.mode}
      </ModeText>
      <ModeText variant="h3" style={styles.homeOverviewTitle}>
        {modeTheme.badge}
      </ModeText>
      <ModeText variant="bodySm" tone="secondary" style={styles.homeOverviewBody}>
        {result.mode_tagline || 'Progress today is about smart decisions, not pressure.'}
      </ModeText>
      {isModeInfoOpen ? (
        <View style={styles.homeOverviewInfoPanel}>
          <ModeText variant="bodySm" tone="secondary" style={styles.homeOverviewInfoBody}>
            {modeGuideCopy}
          </ModeText>
          <View style={styles.homeOverviewInputHeader}>
            <ModeText variant="label" tone="tertiary">Today&apos;s inputs</ModeText>
            <ModeText variant="caption" tone="tertiary">Readiness score {result.score}/25</ModeText>
          </View>
          <View style={styles.homeOverviewInputList}>
            {INPUT_EXPLAINER_FIELDS.map((field) => (
              <View key={field.key} style={styles.homeOverviewInputRow}>
                <ModeText variant="caption" tone="tertiary" style={styles.homeOverviewInputLabel}>
                  {field.label}
                </ModeText>
                <ModeText variant="bodySm" style={styles.homeOverviewInputValue}>
                  {getInputAnswerLabel(field.key, result?.inputs?.[field.key])}
                </ModeText>
              </View>
            ))}
          </View>
        </View>
      ) : null}
      <View style={styles.homeOverviewMindsetWrap}>
        <ModeText variant="label" tone="tertiary">Mindset</ModeText>
        <ModeText variant="h3" style={styles.homeOverviewMindsetValue}>
          {result?.mindset?.cue || 'Show up with disciplined reps.'}
        </ModeText>
      </View>
      <View style={styles.homeOverviewProgressWrap}>
        <ModeText variant="caption" tone="tertiary">Readiness score {result.score}/25</ModeText>
        <ProgressBar
          progress={scoreProgress}
          trackColor="#EFEDE6"
          fillColor={modeTheme.accent}
          style={styles.homeOverviewProgress}
        />
      </View>
      <View style={styles.homeOverviewActions}>
        <ModeButton title="Coach insights" variant="ghost" onPress={onOpenInsights} />
        <ModeButton title="Talk to coach" onPress={onOpenCoachChat} />
      </View>
    </ModeCard>
  );
}

function TopBar({ canGoBack, onGoBack, onSkip, disableSkip }) {
  return (
    <View style={styles.topBar}>
      <Pressable
        accessibilityRole="button"
        disabled={!canGoBack}
        onPress={onGoBack}
        style={({ pressed }) => [
          styles.topBarAction,
          !canGoBack && styles.topBarActionDisabled,
          pressed && canGoBack && styles.topBarActionPressed,
        ]}
      >
        <Feather name="arrow-left" size={22} color={canGoBack ? theme.colors.textHigh : theme.colors.textDisabled} />
      </Pressable>

      <Pressable
        accessibilityRole="button"
        disabled={disableSkip}
        onPress={onSkip}
        style={({ pressed }) => [
          styles.skipButton,
          disableSkip && styles.topBarActionDisabled,
          pressed && !disableSkip && styles.topBarActionPressed,
        ]}
      >
        <Text style={[styles.skipLabel, disableSkip && styles.skipLabelDisabled]}>Skip</Text>
      </Pressable>
    </View>
  );
}

function QuestionScreen({
  question,
  questionIndex,
  justSelected,
  onGoBack,
  onSkip,
  onSelect,
  isBusy,
  topInset,
}) {
  return (
    <View style={[styles.phoneFrame, { paddingTop: Math.max(topInset, theme.spacing[3]) }]}>
      <TopBar
        canGoBack={questionIndex > 0 && !isBusy}
        onGoBack={onGoBack}
        onSkip={onSkip}
        disableSkip={isBusy}
      />

      <View style={styles.questionShell}>
        <View style={[styles.iconTile, { borderColor: withAlpha(question.color, 0.36), backgroundColor: withAlpha(question.color, 0.1) }]}>
          {renderQuestionIcon(question.icon, question.color, 26)}
        </View>

        <View style={styles.questionHeaderBlock}>
          <Text style={styles.questionHeading}>{question.question}</Text>
          <Text style={styles.questionSubtitle}>{question.subtitle}</Text>
        </View>

        <View style={styles.progressRow}>
          {QUESTIONS.map((item, index) => {
            const backgroundColor = index < questionIndex
              ? theme.colors.brand.progressSuccess
              : index === questionIndex
                ? question.color
                : theme.colors.surface.subtle;

            return (
              <View
                key={item.id}
                style={[
                  styles.progressDot,
                  {
                    width: createProgressWidth(index, questionIndex),
                    backgroundColor,
                  },
                ]}
              />
            );
          })}
        </View>

        <View style={styles.optionsList}>
          {question.options.map((option) => {
            const isJustTapped = justSelected === option.score;

            return (
              <Pressable
                key={option.score}
                accessibilityRole="button"
                disabled={isBusy}
                onPress={() => onSelect(option.score)}
                style={({ pressed }) => [
                  styles.answerRow,
                  isJustTapped && {
                    backgroundColor: withAlpha(question.color, 0.1),
                    borderColor: withAlpha(question.color, 0.38),
                    transform: [{ scale: 1.02 }],
                  },
                  pressed && !isBusy && styles.answerRowPressed,
                ]}
              >
                <View style={styles.answerTextBlock}>
                  <Text style={styles.answerLabel}>{option.label}</Text>
                  <Text style={styles.answerSublabel}>{option.sublabel}</Text>
                </View>
                {isJustTapped ? (
                  <View style={[styles.answerCheck, { backgroundColor: question.color }]}>
                    <Feather name="check" size={14} color={theme.colors.text.inverse} />
                  </View>
                ) : (
                  <View style={styles.answerCheckPlaceholder} />
                )}
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

function PlanActionCard({
  icon,
  title,
  subtitle,
  accent,
  onPress,
  style,
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.planActionCard,
        style,
        { borderColor: withAlpha(accent, 0.45) },
        pressed && { transform: [{ scale: 0.99 }], backgroundColor: withAlpha(accent, 0.1) },
      ]}
    >
      <View style={[styles.planActionIconWrap, { backgroundColor: withAlpha(accent, 0.2) }]}>
        <MaterialCommunityIcons name={icon} size={22} color={accent} />
      </View>
      <View style={styles.planActionCopy}>
        <Text style={styles.planActionTitle}>{title}</Text>
        <Text style={styles.planActionSubtitle}>{subtitle}</Text>
      </View>
      <Feather name="arrow-right" size={18} color={accent} style={styles.planActionArrow} />
    </Pressable>
  );
}

function PreviousContextToggle({ previousCheckin, isLoadingPreviousCheckin, includeYesterdayContext, onToggle }) {
  if (isLoadingPreviousCheckin) {
    return (
      <View style={styles.previousCard}>
        <ActivityIndicator size="small" color={theme.colors.accent} />
        <Text style={styles.previousLoadingText}>Looking up yesterday&apos;s check-in…</Text>
      </View>
    );
  }

  if (!previousCheckin) {
    return null;
  }

  return (
    <Pressable onPress={() => onToggle(!includeYesterdayContext)} style={styles.previousCard}>
      <View style={styles.previousLeft}>
        <MaterialCommunityIcons name="calendar-sync" size={18} color={theme.colors.accent} />
        <View style={styles.previousCopyWrap}>
          <Text style={styles.previousTitle}>Use Yesterday&apos;s Data</Text>
          <Text style={styles.previousMeta}>{previousCheckin.mode} • {previousCheckin.score}/25</Text>
        </View>
      </View>
      <View style={[styles.toggleTrack, includeYesterdayContext && styles.toggleTrackOn]}>
        <View style={[styles.toggleThumb, includeYesterdayContext && styles.toggleThumbOn]} />
      </View>
    </Pressable>
  );
}

function TrainingPlanView({ plan, expandedExercises, onToggleExercise, bottomPadding = 120 }) {
  if (!plan) {
    return null;
  }

  return (
    <ScrollView contentContainerStyle={[styles.planScrollContent, { paddingBottom: bottomPadding }]}>
      <View style={styles.trainingHeaderCard}>
        <Text style={styles.trainingTitle}>💪 {plan.title}</Text>
        <Text style={styles.trainingDescription}>{plan.description}</Text>
        <View style={styles.metaRow}>
          <Text style={styles.metaPill}>{plan.difficulty}</Text>
          <Text style={styles.metaPill}>{plan.durationMinutes} min</Text>
          <Text style={styles.metaPill}>{(plan.exercises || []).length} exercises</Text>
        </View>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>🔥 Warm-Up</Text>
        {(plan.warmup || []).map((item, index) => (
          <View key={`warmup-${index}`} style={styles.simpleRow}>
            <View style={[styles.simpleDot, { backgroundColor: theme.colors.emotional.warmGold }]} />
            <View style={styles.simpleBody}>
              <Text style={styles.simpleName}>{item.name}</Text>
              {item.description ? <Text style={styles.simpleDesc}>{item.description}</Text> : null}
            </View>
            <Text style={styles.simpleDuration}>{item.duration}</Text>
          </View>
        ))}
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>💪 Main Workout</Text>
        {(plan.exercises || []).map((exercise, index) => {
          const expanded = Boolean(expandedExercises[index]);
          return (
            <View key={`exercise-${index}`} style={styles.exerciseCard}>
              <View style={styles.exerciseTopRow}>
                <View style={styles.exerciseNumber}><Text style={styles.exerciseNumberText}>{index + 1}</Text></View>
                <View style={styles.exerciseBody}>
                  <Text style={styles.exerciseName}>{exercise.name}</Text>
                  <View style={styles.exerciseMetaRow}>
                    <Text style={styles.exerciseChip}>{exercise.muscleGroup}</Text>
                    <Text style={styles.exerciseChip}>{exercise.sets}x{exercise.reps}</Text>
                    <Text style={styles.exerciseChip}>{exercise.rest}</Text>
                  </View>
                </View>
                <Pressable onPress={() => onToggleExercise(index)} style={styles.chevronButton}>
                  <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={theme.colors.textMedium} />
                </Pressable>
              </View>
              {expanded ? (
                <View style={styles.exerciseExpanded}>
                  <Text style={styles.exerciseDetail}>ℹ️ {exercise.description}</Text>
                  <View style={styles.coachTipBox}>
                    <Text style={styles.coachTipText}>💡 {exercise.coachTip}</Text>
                  </View>
                  <View style={styles.videoPlaceholder}>
                    <Feather name="play-circle" size={24} color={theme.colors.textHigh} />
                    <Text style={styles.videoPlaceholderText}>Video Placeholder</Text>
                  </View>
                </View>
              ) : null}
            </View>
          );
        })}
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>🧊 Cool-Down</Text>
        {(plan.cooldown || []).map((item, index) => (
          <View key={`cooldown-${index}`} style={styles.simpleRow}>
            <View style={[styles.simpleDot, { backgroundColor: theme.colors.brand.progressSoft }]} />
            <View style={styles.simpleBody}>
              <Text style={styles.simpleName}>{item.name}</Text>
              {item.description ? <Text style={styles.simpleDesc}>{item.description}</Text> : null}
            </View>
            <Text style={styles.simpleDuration}>{item.duration}</Text>
          </View>
        ))}
      </View>

      <View style={styles.coachNoteCard}>
        <Text style={styles.coachNoteText}>{plan.coachNote}</Text>
      </View>
    </ScrollView>
  );
}

function GuidedWorkoutView({ plan, elapsedSeconds, guidedStatus, bottomPadding = 120 }) {
  return (
    <ScrollView contentContainerStyle={[styles.planScrollContent, { paddingBottom: bottomPadding }]}>
      <View style={styles.guidedHeroCard}>
        <Text style={styles.guidedEyebrow}>Guided Workout</Text>
        <Text style={styles.guidedTitle}>{plan?.title}</Text>
        <Text style={styles.guidedTimer}>{formatDuration(elapsedSeconds)}</Text>
        <Text style={styles.guidedStatus}>Status: {guidedStatus}</Text>
      </View>
      {(plan?.exercises || []).map((exercise, index) => (
        <View key={`guided-${index}`} style={styles.guidedExerciseRow}>
          <View style={styles.exerciseNumber}><Text style={styles.exerciseNumberText}>{index + 1}</Text></View>
          <View style={styles.exerciseBody}>
            <Text style={styles.exerciseName}>{exercise.name}</Text>
            <Text style={styles.simpleDesc}>{exercise.sets}x{exercise.reps} • Rest {exercise.rest}</Text>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

function NutritionPlanView({ plan }) {
  if (!plan) {
    return null;
  }

  return (
    <ScrollView contentContainerStyle={styles.planScrollContent}>
      <View style={styles.nutritionHeaderCard}>
        <Text style={styles.trainingTitle}>{plan.title}</Text>
        <Text style={styles.nutritionCoachNote}>{plan.coachNote}</Text>
        <View style={styles.metaRow}>
          <Text style={styles.metaPill}>🔥 {plan.totalCalories} kcal</Text>
          <Text style={styles.metaPill}>💪 {plan.totalProtein}g</Text>
        </View>
      </View>

      {(plan.meals || []).map((meal, index) => (
        <View key={`meal-${index}`} style={styles.mealCard}>
          <View style={styles.mealTopRow}>
            <View>
              <Text style={styles.mealName}>{meal.emoji} {meal.name}</Text>
              <Text style={styles.simpleDesc}>{meal.timing}</Text>
            </View>
            <Text style={styles.simpleDesc}>{meal.totalCalories} / {meal.totalProtein}g</Text>
          </View>
          {(meal.foods || []).map((food, foodIndex) => (
            <View key={`food-${foodIndex}`} style={styles.foodRow}>
              <Text style={styles.simpleName}>{food.name} • {food.amount}</Text>
              <Text style={styles.simpleDesc}>{food.calories} kcal • {food.protein}g</Text>
            </View>
          ))}
          {meal.notes ? <Text style={styles.mealNotes}>{meal.notes}</Text> : null}
        </View>
      ))}
    </ScrollView>
  );
}

export default function DailyCheckinScreen({
  accessToken,
  onOpenChat,
  onOpenInsights,
  bottomInset = 0,
  floatingNavClearance = null,
}) {
  const insets = useSafeAreaInsets();
  const sessionStartRef = useRef(Date.now());
  const nutritionDayNoteRef = useRef(null);
  const today = useMemo(() => getLocalDateString(), []);
  const [step, setStep] = useState('loading');
  const [scores, setScores] = useState(createEmptyAnswers);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [justSelected, setJustSelected] = useState(null);
  const [animating, setAnimating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [submitError, setSubmitError] = useState(null);
  const [summaryResult, setSummaryResult] = useState(null);
  const [isModeInfoOpen, setIsModeInfoOpen] = useState(false);
  const [submitState, setSubmitState] = useState('idle');
  const [copyFeedback, setCopyFeedback] = useState(null);
  const [planType, setPlanType] = useState(null);
  const [environment, setEnvironment] = useState(null);
  const [timeAvailable, setTimeAvailable] = useState(30);
  const [nutritionDayType, setNutritionDayType] = useState(null);
  const [nutritionDayNote, setNutritionDayNote] = useState('');
  const [previousCheckin, setPreviousCheckin] = useState(null);
  const [isLoadingPreviousCheckin, setIsLoadingPreviousCheckin] = useState(false);
  const [includeYesterdayContext, setIncludeYesterdayContext] = useState(false);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState(null);
  const [planContent, setPlanContent] = useState(null);
  const [structuredPlan, setStructuredPlan] = useState(null);
  const [structuredNutritionPlan, setStructuredNutritionPlan] = useState(null);
  const [generatedPlanId, setGeneratedPlanId] = useState(null);
  const [generatedWorkoutContext, setGeneratedWorkoutContext] = useState(null);
  const [expandedExercises, setExpandedExercises] = useState({});
  const [guidedStatus, setGuidedStatus] = useState('idle');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isLogOpen, setIsLogOpen] = useState(false);
  const [feelRating, setFeelRating] = useState(3);
  const [isLoggingWorkout, setIsLoggingWorkout] = useState(false);
  const [logFeedback, setLogFeedback] = useState(null);
  const [connectionDebug, setConnectionDebug] = useState(() => buildConnectionDebugSnapshot());
  const [isHealthzProbeRunning, setIsHealthzProbeRunning] = useState(false);
  const [isTodayProbeRunning, setIsTodayProbeRunning] = useState(false);
  const copyFeedbackTimerRef = useRef(null);
  const currentQuestion = QUESTIONS[questionIndex];
  const glowProgress = useRef(new Animated.Value(1)).current;
  const glowTargetRef = useRef(QUESTIONS[0].color);
  const [glowFromColor, setGlowFromColor] = useState(QUESTIONS[0].color);
  const [glowToColor, setGlowToColor] = useState(QUESTIONS[0].color);
  const planDiagnosticsLine = useMemo(() => buildPlanDiagnosticsLine(planError), [planError]);
  const showConnectionDebug = __DEV__ && SHOW_DEV_CONNECTION_DEBUG;

  useEffect(() => {
    if (currentQuestion.color === glowTargetRef.current) {
      return;
    }

    setGlowFromColor(glowTargetRef.current);
    setGlowToColor(currentQuestion.color);
    glowTargetRef.current = currentQuestion.color;
    glowProgress.setValue(0);
    Animated.timing(glowProgress, {
      toValue: 1,
      duration: 1000,
      useNativeDriver: false,
    }).start();
  }, [currentQuestion.color, glowProgress]);

  const hasSummary = Boolean(summaryResult);
  const glowColor = glowProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [glowFromColor, glowToColor],
  });

  const refreshConnectionDebug = useCallback((overrides = {}) => {
    setConnectionDebug(buildConnectionDebugSnapshot(overrides));
  }, []);

  const handleProbeHealthz = async () => {
    if (isHealthzProbeRunning || isTodayProbeRunning) {
      return;
    }

    setIsHealthzProbeRunning(true);
    refreshConnectionDebug({
      lastProbe: {
        type: 'healthz',
        label: 'Healthz probe',
        status: 'running',
      },
    });

    try {
      const result = await probeBackendHealthz();
      refreshConnectionDebug({
        lastProbe: {
          type: 'healthz',
          label: 'Healthz probe',
          status: 'ok',
          httpStatus: result.status,
          baseUrl: result.baseUrl,
          message: JSON.stringify(result.payload),
        },
      });
    } catch (error) {
      refreshConnectionDebug({
        lastProbe: {
          type: 'healthz',
          label: 'Healthz probe',
          status: 'error',
          httpStatus: error?.status || null,
          baseUrl: error?.resolved_api_base_url || error?.base_url || null,
          message: error?.message || 'Probe failed',
        },
      });
    } finally {
      setIsHealthzProbeRunning(false);
    }
  };

  const handleProbeToday = async () => {
    if (isHealthzProbeRunning || isTodayProbeRunning) {
      return;
    }

    setIsTodayProbeRunning(true);
    refreshConnectionDebug({
      lastProbe: {
        type: 'checkin_today',
        label: 'Check-in probe',
        status: 'running',
      },
    });

    try {
      const result = await probeTodayCheckin({ accessToken, date: today });
      refreshConnectionDebug({
        lastProbe: {
          type: 'checkin_today',
          label: 'Check-in probe',
          status: 'ok',
          baseUrl: getApiDebugInfo().resolvedApiBaseUrl,
          message: JSON.stringify({
            completed: result?.payload?.completed,
            date: result?.payload?.date,
          }),
        },
      });
    } catch (error) {
      refreshConnectionDebug({
        lastProbe: {
          type: 'checkin_today',
          label: 'Check-in probe',
          status: 'error',
          httpStatus: error?.status || null,
          baseUrl: error?.resolved_api_base_url || null,
          message: error?.message || 'Probe failed',
        },
      });
    } finally {
      setIsTodayProbeRunning(false);
    }
  };

  const loadToday = useCallback(async () => {
    setIsLoading(true);
    setStep('loading');
    setErrorMessage(null);
    setSubmitError(null);
    setCopyFeedback(null);

    try {
      const nextStatus = await getTodayCheckin({ accessToken });
      refreshConnectionDebug({
        lastProbe: {
          type: 'load_today',
          label: 'Load today',
          status: 'ok',
          baseUrl: getApiDebugInfo().resolvedApiBaseUrl,
          message: JSON.stringify({
            completed: nextStatus?.completed,
            date: nextStatus?.date,
          }),
        },
      });
      if (nextStatus.completed) {
        setSummaryResult(nextStatus.checkin);
        setSubmitState('saved');
        setStep('summary');
      } else {
        setScores(createEmptyAnswers());
        setQuestionIndex(0);
        setJustSelected(null);
        setAnimating(false);
        setSummaryResult(null);
        setSubmitState('idle');
        setSubmitError(null);
        sessionStartRef.current = Date.now();
        setStep('questionnaire');
      }
    } catch (error) {
      refreshConnectionDebug({
        lastProbe: {
          type: 'load_today',
          label: 'Load today',
          status: 'error',
          httpStatus: error?.status || null,
          baseUrl: error?.resolved_api_base_url || null,
          message: error?.message || 'Unable to load today',
        },
      });
      setErrorMessage(error.message || 'Unable to load today\'s check-in.');
      setSummaryResult(null);
      setSubmitState('idle');
      setStep('load-error');
    } finally {
      setIsLoading(false);
    }
  }, [accessToken, refreshConnectionDebug]);

  useEffect(() => {
    loadToday();
  }, [loadToday]);

  useEffect(() => () => {
    if (copyFeedbackTimerRef.current) {
      clearTimeout(copyFeedbackTimerRef.current);
    }
  }, []);

  useEffect(() => {
    setIsModeInfoOpen(false);
  }, [summaryResult]);

  useEffect(() => {
    refreshConnectionDebug();
  }, [accessToken, refreshConnectionDebug, today]);

  useEffect(() => {
    if (step !== 'environment') {
      return;
    }

    let cancelled = false;

    const loadPreviousCheckin = async () => {
      setIsLoadingPreviousCheckin(true);
      setPreviousCheckin(null);
      setIncludeYesterdayContext(false);

      try {
        const response = await getPreviousCheckin({
          accessToken,
          beforeDate: today,
        });
        if (cancelled) {
          return;
        }
        setPreviousCheckin(response?.checkin || null);
      } catch (_error) {
        if (cancelled) {
          return;
        }
        setPreviousCheckin(null);
      } finally {
        if (!cancelled) {
          setIsLoadingPreviousCheckin(false);
        }
      }
    };

    loadPreviousCheckin();

    return () => {
      cancelled = true;
    };
  }, [accessToken, step, today]);

  useEffect(() => {
    if (step === 'environment' && planType === PLAN_TYPE.NUTRITION && nutritionDayType === 'custom') {
      setTimeout(() => {
        nutritionDayNoteRef.current?.focus?.();
      }, 25);
    }
  }, [nutritionDayType, planType, step]);

  useEffect(() => {
    if (step !== 'guided-workout' || guidedStatus !== 'running') {
      return undefined;
    }

    const interval = setInterval(() => {
      setElapsedSeconds((previous) => previous + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [step, guidedStatus]);

  const showCopyFeedback = (message) => {
    if (copyFeedbackTimerRef.current) {
      clearTimeout(copyFeedbackTimerRef.current);
    }

    setCopyFeedback(message);
    copyFeedbackTimerRef.current = setTimeout(() => {
      setCopyFeedback(null);
      copyFeedbackTimerRef.current = null;
    }, 2200);
  };

  const handleGoBack = () => {
    if (animating || isSubmitting || questionIndex === 0) {
      return;
    }
    setQuestionIndex((current) => current - 1);
  };

  const handleSubmit = async (updatedScores) => {
    if (isSubmitting) {
      return;
    }

    const timeToComplete = Math.max(1, Math.round((Date.now() - sessionStartRef.current) / 1000));

    setStep('reviewing');
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const result = await submitTodayCheckin({
        accessToken,
        date: today,
        inputs: updatedScores,
        timeToComplete,
      });
      setSummaryResult(result);
      setSubmitState('saved');
      setSubmitError(null);
      setCopyFeedback(null);
      setStep('summary');
    } catch (error) {
      refreshConnectionDebug({
        lastProbe: {
          type: 'submit_checkin',
          label: 'Submit check-in',
          status: 'error',
          httpStatus: error?.status || null,
          baseUrl: error?.resolved_api_base_url || null,
          message: error?.message || 'Unable to submit check-in',
        },
      });
      setErrorMessage(error.message || 'Unable to submit today\'s check-in.');
      setSubmitError(error);
      setSummaryResult(buildFallbackResult({
        date: today,
        inputs: updatedScores,
        timeToComplete,
      }));
      setSubmitState('pending');
      logSubmitFailure({ date: today, inputs: updatedScores, error });
      setStep('summary');
    } finally {
      setIsSubmitting(false);
      setAnimating(false);
      setJustSelected(null);
    }
  };

  const handleCopyDetails = async () => {
    try {
      const supportBundle = buildSupportBundle({
        date: today,
        result: summaryResult,
        submitError,
      });
      await Clipboard.setStringAsync(supportBundle);
      showCopyFeedback('Copied to clipboard');
    } catch (_error) {
      showCopyFeedback('Unable to copy details');
    }
  };

  const handleOptionTap = (score) => {
    if (animating || isSubmitting) {
      return;
    }

    setAnimating(true);
    setJustSelected(score);
    const updatedScores = {
      ...scores,
      [currentQuestion.key]: score,
    };
    setScores(updatedScores);

    requestAnimationFrame(() => {
      setJustSelected(null);
      if (questionIndex < QUESTIONS.length - 1) {
        setQuestionIndex((current) => current + 1);
        setAnimating(false);
        return;
      }
      handleSubmit(updatedScores);
    });
  };

  const resetPlanState = () => {
    setEnvironment(null);
    setTimeAvailable(30);
    setNutritionDayType(null);
    setNutritionDayNote('');
    setPreviousCheckin(null);
    setIncludeYesterdayContext(false);
    setPlanLoading(false);
    setPlanError(null);
    setPlanContent(null);
    setStructuredPlan(null);
    setStructuredNutritionPlan(null);
    setGeneratedPlanId(null);
    setGeneratedWorkoutContext(null);
    setExpandedExercises({});
    setGuidedStatus('idle');
    setElapsedSeconds(0);
    setIsLogOpen(false);
    setFeelRating(3);
    setIsLoggingWorkout(false);
    setLogFeedback(null);
  };

  const handleSelectPlan = (type) => {
    setPlanType(type);
    resetPlanState();
    setStep('environment');
  };

  const handleOpenCoachChat = () => {
    if (typeof onOpenChat !== 'function') {
      return;
    }
    onOpenChat({
      entrypoint: 'post_checkin',
      checkin_context: {
        checkin_id: summaryResult?.id || null,
        checkin_date: summaryResult?.date || today,
        assigned_mode: summaryResult?.mode || null,
        checkin_score: summaryResult?.score ?? null,
      },
    });
  };

  const handleOpenInsights = () => {
    if (typeof onOpenInsights === 'function') {
      onOpenInsights();
    }
  };

  const handleOpenWorkoutCoach = () => {
    if (typeof onOpenChat !== 'function' || !structuredPlan) {
      return;
    }

    onOpenChat(buildWorkoutLaunchContext({
      result: summaryResult,
      date: today,
      workoutContext: generatedWorkoutContext || {
        generated_plan_id: generatedPlanId || null,
        environment: environment || null,
        time_available: timeAvailable ?? null,
        plan_title: structuredPlan?.title || null,
        plan_summary: buildWorkoutSummary(structuredPlan),
      },
    }));
  };

  const handleOpenNutritionCoach = () => {
    if (typeof onOpenChat !== 'function' || !structuredNutritionPlan) {
      return;
    }

    onOpenChat(buildNutritionLaunchContext({
      result: summaryResult,
      date: today,
      nutritionContext: {
        generated_plan_id: generatedPlanId || null,
        plan_title: structuredNutritionPlan?.title || null,
        coach_note: structuredNutritionPlan?.coachNote || null,
        plan_summary: buildNutritionSummary(structuredNutritionPlan),
      },
    }));
  };

  const canGeneratePlan = useMemo(() => {
    if (planType === PLAN_TYPE.TRAINING) {
      return Boolean(environment);
    }
    if (planType === PLAN_TYPE.NUTRITION) {
      if (!nutritionDayType) {
        return false;
      }
      if (nutritionDayType === 'custom') {
        return nutritionDayNote.trim().length > 0;
      }
      return true;
    }
    return false;
  }, [environment, nutritionDayNote, nutritionDayType, planType]);

  const handleGeneratePlan = async (refreshRequestedOrEvent = false) => {
    const refreshRequested = refreshRequestedOrEvent === true;
    if (!summaryResult?.id || !planType || !canGeneratePlan || planLoading) {
      return;
    }

    setPlanLoading(true);
    setPlanError(null);
    setCopyFeedback(null);
    setStep('plan');

    try {
      const result = await generateCheckinPlan({
        accessToken,
        checkinId: summaryResult.id,
        planType,
        environment: planType === PLAN_TYPE.TRAINING ? environment : undefined,
        timeAvailable: planType === PLAN_TYPE.TRAINING ? timeAvailable : undefined,
        nutritionDayNote: planType === PLAN_TYPE.NUTRITION && nutritionDayType === 'custom'
          ? nutritionDayNote.trim()
          : undefined,
        includeYesterdayContext,
        refreshRequested,
      });

      refreshConnectionDebug({
        lastProbe: {
          type: 'generate_plan',
          label: 'Generate plan',
          status: 'ok',
          baseUrl: getApiDebugInfo().resolvedApiBaseUrl,
          message: JSON.stringify({
            planId: result?.plan_id,
            fingerprint: result?.request_fingerprint,
            revision: result?.revision_number,
          }),
        },
      });

      setGeneratedPlanId(result.plan_id || null);
      setPlanContent(result.content || null);
      setStructuredPlan(null);
      setStructuredNutritionPlan(null);
      setGeneratedWorkoutContext(result.workout_context || null);

      if (result.structured && planType === PLAN_TYPE.TRAINING) {
        setStructuredPlan(result.structured);
      } else if (result.structured && planType === PLAN_TYPE.NUTRITION) {
        setStructuredNutritionPlan(result.structured);
      }
    } catch (error) {
      refreshConnectionDebug({
        lastProbe: {
          type: 'generate_plan',
          label: 'Generate plan',
          status: 'error',
          httpStatus: error?.status || null,
          baseUrl: error?.resolved_api_base_url || null,
          message: error?.message || 'Unable to generate plan',
        },
      });
      const nextError = error instanceof Error
        ? error
        : new Error(error?.message || 'Unable to generate your plan right now.');
      setPlanError(nextError);
    } finally {
      setPlanLoading(false);
    }
  };

  const handleCopyPlanDiagnostics = async () => {
    if (!planError) {
      return;
    }

    try {
      const supportBundle = buildPlanSupportBundle({
        date: today,
        planType,
        checkinId: summaryResult?.id,
        environment,
        timeAvailable,
        nutritionDayType,
        nutritionDayNote: nutritionDayType === 'custom' ? nutritionDayNote.trim() : null,
        includeYesterdayContext,
        planError,
      });
      await Clipboard.setStringAsync(supportBundle);
      showCopyFeedback('Copied diagnostics');
    } catch (_error) {
      showCopyFeedback('Unable to copy diagnostics');
    }
  };

  const handleToggleExercise = (index) => {
    setExpandedExercises((previous) => ({
      ...previous,
      [index]: !previous[index],
    }));
  };

  const handleBeginGuidedWorkout = () => {
    setStep('guided-workout');
    setGuidedStatus('running');
    setElapsedSeconds(0);
    setLogFeedback(null);
  };

  const handleBackFromGuidedWorkout = () => {
    if (guidedStatus === 'running') {
      setGuidedStatus('paused');
    }
    setStep('plan');
  };

  const handlePauseResume = () => {
    setGuidedStatus((current) => (current === 'running' ? 'paused' : 'running'));
  };

  const handleOpenLogPanel = () => {
    setGuidedStatus('paused');
    setIsLogOpen(true);
  };

  const handleLogWorkout = async () => {
    if (!generatedPlanId || !structuredPlan || isLoggingWorkout) {
      return;
    }

    setIsLoggingWorkout(true);
    setLogFeedback(null);

    try {
      await logGeneratedWorkout({
        accessToken,
        generatedPlanId,
        title: structuredPlan.title || 'Guided Workout',
        elapsedSeconds,
        completed: true,
        feelRating,
      });
      setIsLogOpen(false);
      setGuidedStatus('idle');
      setElapsedSeconds(0);
      setLogFeedback('Workout logged successfully.');
      setStep('plan');
    } catch (error) {
      setLogFeedback(error.message || 'Unable to log workout right now.');
    } finally {
      setIsLoggingWorkout(false);
    }
  };

  const coachName = getCoachName(summaryResult?.mode);
  const inferredFloatingNavClearance = Math.max(bottomInset - 34, 0);
  const resolvedFloatingNavClearance = typeof floatingNavClearance === 'number'
    ? floatingNavClearance
    : inferredFloatingNavClearance;
  const planPrimaryCtaBottom = resolvedFloatingNavClearance + 8;
  const planCtaOffset = planPrimaryCtaBottom + 88;

  return (
    <SafeScreen includeTopInset={false} style={styles.screen}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.glowOrb,
          {
            backgroundColor: glowColor,
          },
        ]}
      />
      <BackgroundGrid />

      {(isLoading || step === 'loading') ? (
        <View style={styles.loadingScreen}>
          <ActivityIndicator size="large" color={theme.colors.accent} />
          <Text style={styles.loadingTitle}>Loading your check-in</Text>
          <Text style={styles.loadingBody}>Pulling today&apos;s status and preparing your flow.</Text>
        </View>
      ) : null}

      {step === 'questionnaire' ? (
        <View style={[styles.centerStage, { paddingBottom: theme.spacing[3] + bottomInset }]}>
          <QuestionScreen
            question={currentQuestion}
            questionIndex={questionIndex}
            justSelected={justSelected}
            onGoBack={handleGoBack}
            onSkip={() => handleOptionTap(3)}
            onSelect={handleOptionTap}
            isBusy={animating || isSubmitting}
            topInset={insets.top}
          />
        </View>
      ) : null}

      {step === 'reviewing' ? (
        <View style={styles.loadingScreen}>
          <View style={styles.reviewCard}>
            <ActivityIndicator size="large" color={currentQuestion.color} />
            <Text style={styles.reviewTitle}>Coach is reviewing your details</Text>
            <Text style={styles.reviewBody}>Turning five honest answers into today&apos;s call.</Text>
          </View>
        </View>
      ) : null}

      {step === 'summary' && hasSummary ? (
        <ScrollView
          contentContainerStyle={[
            styles.resultsContent,
            {
              paddingTop: Math.max(insets.top, theme.spacing[3]),
              paddingBottom: theme.spacing[4] + bottomInset,
            },
          ]}
        >
          <View style={styles.phoneFrame}>
            <Text style={styles.resultsEyebrow}>{formatTodayLabel(today)}</Text>
            <HomeOverviewCard
              result={summaryResult}
              isModeInfoOpen={isModeInfoOpen}
              onToggleModeInfo={() => setIsModeInfoOpen((current) => !current)}
              onOpenInsights={handleOpenInsights}
              onOpenCoachChat={handleOpenCoachChat}
            />
            {submitState === 'pending' ? (
              <View style={styles.summaryStatusCard}>
                <Text style={styles.summaryStatusTitle}>Save still pending</Text>
                <Text style={styles.summaryStatusBody}>
                  {errorMessage || 'The check-in summary below is based on your completed answers. Retry to save it to your account.'}
                </Text>
                {copyFeedback ? (
                  <Text
                    style={[
                      styles.copyFeedback,
                      copyFeedback === 'Copied to clipboard' ? styles.copyFeedbackSuccess : styles.copyFeedbackError,
                    ]}
                  >
                    {copyFeedback}
                  </Text>
                ) : null}
              </View>
            ) : null}
            <ResultCard
              result={summaryResult}
              onBuildTraining={() => handleSelectPlan(PLAN_TYPE.TRAINING)}
              onBuildNutrition={() => handleSelectPlan(PLAN_TYPE.NUTRITION)}
              showPlanActions={submitState === 'saved' && Boolean(summaryResult?.id)}
            />
          </View>
          {submitState === 'pending' ? (
            <ModeButton
              title="Retry save"
              onPress={() => handleSubmit(scores)}
              style={styles.footerButton}
            />
          ) : null}
          {submitState === 'pending' ? (
            <ModeButton
              title="Copy details"
              variant="secondary"
              onPress={handleCopyDetails}
              style={styles.footerButton}
            />
          ) : null}
          <ConnectionDebugCard
            debugState={connectionDebug}
            isHealthzProbeRunning={isHealthzProbeRunning}
            isTodayProbeRunning={isTodayProbeRunning}
            onProbeHealthz={handleProbeHealthz}
            onProbeToday={handleProbeToday}
            visible={showConnectionDebug}
          />
        </ScrollView>
      ) : null}

      {step === 'environment' ? (
        <View style={styles.planStepWrap}>
          <HeaderBar
            title={planType === PLAN_TYPE.TRAINING ? 'Training Setup' : 'Nutrition Setup'}
            onBack={() => setStep('summary')}
            backAccessibilityLabel="Back to summary"
          />
          <ScrollView
            contentContainerStyle={[
              styles.resultsContent,
              {
                paddingTop: theme.spacing[3],
                paddingBottom: theme.spacing[4] + bottomInset,
              },
            ]}
          >
            <View style={styles.phoneFrame}>
              <Text style={styles.resultsTitle}>
                {planType === PLAN_TYPE.TRAINING ? 'Dial in your workout context' : 'Dial in today\'s nutrition context'}
              </Text>

              <PreviousContextToggle
                previousCheckin={previousCheckin}
                isLoadingPreviousCheckin={isLoadingPreviousCheckin}
                includeYesterdayContext={includeYesterdayContext}
                onToggle={setIncludeYesterdayContext}
              />

              {planType === PLAN_TYPE.TRAINING ? (
                <>
                  <Text style={styles.sectionHeading}>Environment</Text>
                  <View style={styles.environmentGrid}>
                    {ENVIRONMENT_OPTIONS.map((option) => {
                      const selected = environment === option.value;
                      return (
                        <Pressable
                          key={option.value}
                          onPress={() => setEnvironment(option.value)}
                          style={({ pressed }) => [
                            styles.environmentCard,
                            selected && styles.environmentCardSelected,
                            pressed && styles.environmentCardPressed,
                          ]}
                        >
                          <Text style={styles.environmentEmoji}>{option.emoji}</Text>
                          <Text style={styles.environmentLabel}>{option.label}</Text>
                          <Text style={styles.environmentDesc}>{option.description}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Text style={styles.sectionHeading}>Time available</Text>
                  <View style={styles.timePillRow}>
                    {TIME_OPTIONS.map((minutes) => {
                      const selected = timeAvailable === minutes;
                      return (
                        <Pressable
                          key={minutes}
                          onPress={() => setTimeAvailable(minutes)}
                          style={[styles.timePill, selected && styles.timePillSelected]}
                        >
                          <Text style={[styles.timePillText, selected && styles.timePillTextSelected]}>{minutes}m</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              ) : (
                <>
                  <Text style={styles.sectionHeading}>Day Type</Text>
                  <View style={styles.dayTypeList}>
                    <Pressable
                      onPress={() => {
                        setNutritionDayType('normal');
                        setNutritionDayNote('');
                      }}
                      style={[styles.dayTypeCard, nutritionDayType === 'normal' && styles.dayTypeCardSelected]}
                    >
                      <Text style={styles.dayTypeTitle}>📅 Normal day</Text>
                      <Text style={styles.dayTypeBody}>Regular routine, no special context</Text>
                    </Pressable>

                    <Pressable
                      onPress={() => setNutritionDayType('custom')}
                      style={[styles.dayTypeCard, nutritionDayType === 'custom' && styles.dayTypeCardSelected]}
                    >
                      <Text style={styles.dayTypeTitle}>✏️ Something different today</Text>
                      <Text style={styles.dayTypeBody}>Travel, event, dietary change, etc.</Text>
                    </Pressable>
                  </View>

                  {nutritionDayType === 'custom' ? (
                    <TextInput
                      ref={nutritionDayNoteRef}
                      style={styles.nutritionNoteInput}
                      value={nutritionDayNote}
                      onChangeText={setNutritionDayNote}
                      placeholder="I'm at a hotel in Austin, eating out for every meal"
                      placeholderTextColor={theme.colors.textDisabled}
                      multiline
                      textAlignVertical="top"
                    />
                  ) : null}
                </>
              )}
            </View>

            <ModeButton
              title={planType === PLAN_TYPE.TRAINING ? 'Generate My Workout' : 'Generate My Nutrition Plan'}
              onPress={() => handleGeneratePlan(false)}
              disabled={!canGeneratePlan || planLoading}
              style={[styles.footerButton, styles.generateButton]}
            />
            <ConnectionDebugCard
              debugState={connectionDebug}
              isHealthzProbeRunning={isHealthzProbeRunning}
              isTodayProbeRunning={isTodayProbeRunning}
              onProbeHealthz={handleProbeHealthz}
              onProbeToday={handleProbeToday}
              visible={showConnectionDebug}
            />
          </ScrollView>
        </View>
      ) : null}

      {step === 'plan' ? (
        <View style={styles.planStepWrap}>
          {planType === PLAN_TYPE.TRAINING ? (
            <>
              <HeaderBar
                title="Generated Workout"
                style={styles.generatedWorkoutHeaderBar}
                onBack={() => setStep('environment')}
                backAccessibilityLabel="Back to options"
                rightSlot={
                  !planLoading && !planError && structuredPlan ? (
                    <Pressable
                      accessibilityLabel="Adjust with Coach"
                      accessibilityRole="button"
                      hitSlop={10}
                      onPress={handleOpenWorkoutCoach}
                      style={({ pressed }) => [
                        styles.planAdjustButton,
                        pressed && styles.planAdjustButtonPressed,
                      ]}
                    >
                      <Feather name="message-circle" size={16} color={theme.colors.text.primary} />
                      <Text style={styles.planAdjustButtonLabel}>Coach</Text>
                    </Pressable>
                  ) : null
                }
              />

              {planLoading ? (
                <View style={styles.planLoadingWrap}>
                  <ActivityIndicator size="large" color={theme.colors.primary} />
                  <Text style={styles.planLoadingText}>Coach {coachName} is building your workout...</Text>
                  <View style={styles.typingDotsRow}>
                    <View style={styles.typingDot} />
                    <View style={styles.typingDot} />
                    <View style={styles.typingDot} />
                  </View>
                </View>
              ) : null}

              {!planLoading && planError ? (
                <View style={styles.planErrorCard}>
                  <Text style={styles.errorTitle}>Couldn&apos;t generate your plan</Text>
                  <Text style={styles.errorText}>{planError?.message || 'Unable to generate your plan right now.'}</Text>
                  {planDiagnosticsLine ? <Text style={styles.planDiagnosticsText}>{planDiagnosticsLine}</Text> : null}
                  {planError?.stage === 'network' && planError?.resolved_api_base_url ? (
                    <Text style={styles.planHintText}>Resolved API: {planError.resolved_api_base_url}</Text>
                  ) : null}
                  {planError?.stage === 'network' && Array.isArray(planError?.attempted_base_urls) && planError.attempted_base_urls.length > 0 ? (
                    <Text style={styles.planHintText}>Attempted hosts: {planError.attempted_base_urls.join(', ')}</Text>
                  ) : null}
                  {planError?.hint ? <Text style={styles.planHintText}>Hint: {planError.hint}</Text> : null}
                  <ModeButton title="Try again" onPress={() => handleGeneratePlan(false)} style={styles.errorButton} />
                  <ModeButton
                    title="Copy diagnostics"
                    variant="secondary"
                    onPress={handleCopyPlanDiagnostics}
                    style={styles.errorButton}
                  />
                  {copyFeedback ? (
                    <Text
                      style={[
                        styles.copyFeedback,
                        copyFeedback === 'Copied diagnostics' ? styles.copyFeedbackSuccess : styles.copyFeedbackError,
                      ]}
                    >
                      {copyFeedback}
                    </Text>
                  ) : null}
                </View>
              ) : null}

              {!planLoading && !planError && structuredPlan ? (
                <>
                  <TrainingPlanView
                    plan={structuredPlan}
                    expandedExercises={expandedExercises}
                    onToggleExercise={handleToggleExercise}
                    bottomPadding={planCtaOffset}
                  />
                  <View style={[styles.bottomCtaBar, styles.bottomSingleCtaBar, { bottom: planPrimaryCtaBottom }]}>
                    <ModeButton
                      title="Begin Guided Workout"
                      onPress={handleBeginGuidedWorkout}
                      style={[styles.guidedButton, styles.guidedButtonPrimary]}
                    />
                    {logFeedback ? <Text style={styles.logFeedback}>{logFeedback}</Text> : null}
                  </View>
                </>
              ) : null}

              {!planLoading && !planError && !structuredPlan && planContent ? (
                <ScrollView contentContainerStyle={[styles.planScrollContent, { paddingBottom: planCtaOffset }]}>
                  <View style={styles.sectionCard}>
                    <Text style={styles.sectionTitle}>Generated Content</Text>
                    <Text style={styles.simpleDesc}>{planContent}</Text>
                  </View>
                </ScrollView>
              ) : null}
            </>
          ) : (
            <>
              <HeaderBar
                title="Generated Nutrition Plan"
                style={styles.generatedWorkoutHeaderBar}
                onBack={() => setStep('environment')}
                backAccessibilityLabel="Back to options"
                rightSlot={
                  !planLoading && !planError && structuredNutritionPlan ? (
                    <Pressable
                      accessibilityLabel="Chat with Coach about nutrition plan"
                      accessibilityRole="button"
                      hitSlop={10}
                      onPress={handleOpenNutritionCoach}
                      style={({ pressed }) => [
                        styles.planAdjustButton,
                        pressed && styles.planAdjustButtonPressed,
                      ]}
                    >
                      <Feather name="message-circle" size={16} color={theme.colors.text.primary} />
                      <Text style={styles.planAdjustButtonLabel}>Coach</Text>
                    </Pressable>
                  ) : null
                }
              />

              {planLoading ? (
                <View style={styles.planLoadingWrap}>
                  <ActivityIndicator size="large" color={theme.colors.primary} />
                  <Text style={styles.planLoadingText}>
                    Coach {coachName} is building your nutrition plan...
                  </Text>
                  <View style={styles.typingDotsRow}>
                    <View style={styles.typingDot} />
                    <View style={styles.typingDot} />
                    <View style={styles.typingDot} />
                  </View>
                </View>
              ) : null}

              {!planLoading && planError ? (
                <View style={styles.planErrorCard}>
                  <Text style={styles.errorTitle}>Couldn&apos;t generate your plan</Text>
                  <Text style={styles.errorText}>{planError?.message || 'Unable to generate your plan right now.'}</Text>
                  {planDiagnosticsLine ? <Text style={styles.planDiagnosticsText}>{planDiagnosticsLine}</Text> : null}
                  {planError?.stage === 'network' && planError?.resolved_api_base_url ? (
                    <Text style={styles.planHintText}>Resolved API: {planError.resolved_api_base_url}</Text>
                  ) : null}
                  {planError?.stage === 'network' && Array.isArray(planError?.attempted_base_urls) && planError?.attempted_base_urls.length > 0 ? (
                    <Text style={styles.planHintText}>Attempted hosts: {planError.attempted_base_urls.join(', ')}</Text>
                  ) : null}
                  {planError?.hint ? <Text style={styles.planHintText}>Hint: {planError.hint}</Text> : null}
                  <ModeButton title="Try again" onPress={() => handleGeneratePlan(false)} style={styles.errorButton} />
                  <ModeButton
                    title="Copy diagnostics"
                    variant="secondary"
                    onPress={handleCopyPlanDiagnostics}
                    style={styles.errorButton}
                  />
                  {copyFeedback ? (
                    <Text
                      style={[
                        styles.copyFeedback,
                        copyFeedback === 'Copied diagnostics' ? styles.copyFeedbackSuccess : styles.copyFeedbackError,
                      ]}
                    >
                      {copyFeedback}
                    </Text>
                  ) : null}
                </View>
              ) : null}

              {!planLoading && !planError && structuredNutritionPlan ? (
                <NutritionPlanView plan={structuredNutritionPlan} />
              ) : null}

              {!planLoading && !planError && !structuredNutritionPlan && planContent ? (
                <ScrollView contentContainerStyle={styles.planScrollContent}>
                  <View style={styles.sectionCard}>
                    <Text style={styles.sectionTitle}>Generated Content</Text>
                    <Text style={styles.simpleDesc}>{planContent}</Text>
                  </View>
                </ScrollView>
              ) : null}
            </>
          )}
          <ConnectionDebugCard
            debugState={connectionDebug}
            isHealthzProbeRunning={isHealthzProbeRunning}
            isTodayProbeRunning={isTodayProbeRunning}
            onProbeHealthz={handleProbeHealthz}
            onProbeToday={handleProbeToday}
            visible={showConnectionDebug}
          />
        </View>
      ) : null}

      {step === 'guided-workout' ? (
        <View style={styles.planStepWrap}>
          <HeaderBar
            title="Guided Workout"
            onBack={handleBackFromGuidedWorkout}
            backAccessibilityLabel="Back to generated workout"
          />

          <GuidedWorkoutView
            plan={structuredPlan}
            elapsedSeconds={elapsedSeconds}
            guidedStatus={guidedStatus}
            bottomPadding={planCtaOffset}
          />

          <View style={[styles.bottomCtaBar, { bottom: bottomInset }]}>
            <View style={styles.splitRow}>
              <Pressable onPress={handlePauseResume} style={[styles.splitButton, styles.pauseButton]}>
                <Text style={styles.splitButtonText}>{guidedStatus === 'paused' ? 'Resume' : 'Pause'}</Text>
              </Pressable>
              <Pressable onPress={handleOpenLogPanel} style={[styles.splitButton, styles.endButton]}>
                <Text style={styles.splitButtonText}>End & Log</Text>
              </Pressable>
            </View>
            {logFeedback ? <Text style={styles.logFeedback}>{logFeedback}</Text> : null}
          </View>

          <ConnectionDebugCard
            debugState={connectionDebug}
            isHealthzProbeRunning={isHealthzProbeRunning}
            isTodayProbeRunning={isTodayProbeRunning}
            onProbeHealthz={handleProbeHealthz}
            onProbeToday={handleProbeToday}
            visible={showConnectionDebug}
          />
        </View>
      ) : null}

      {step === 'load-error' ? (
        <View style={styles.loadingScreen}>
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>We couldn&apos;t load today&apos;s check-in.</Text>
            <Text style={styles.errorText}>{errorMessage || 'Something went wrong while loading your check-in.'}</Text>
            <ModeButton
              title="Try again"
              onPress={loadToday}
              style={styles.errorButton}
            />
            <ConnectionDebugCard
              debugState={connectionDebug}
              isHealthzProbeRunning={isHealthzProbeRunning}
              isTodayProbeRunning={isTodayProbeRunning}
              onProbeHealthz={handleProbeHealthz}
              onProbeToday={handleProbeToday}
              visible={showConnectionDebug}
            />
          </View>
        </View>
      ) : null}

      {isLogOpen ? (
        <View style={styles.logOverlay}>
          <View style={styles.logSheet}>
            <Text style={styles.logSheetTitle}>How did this session feel?</Text>
            <View style={styles.feelRatingRow}>
              {[1, 2, 3, 4, 5].map((value) => (
                <Pressable
                  key={value}
                  onPress={() => setFeelRating(value)}
                  style={[styles.ratingPill, feelRating === value && styles.ratingPillSelected]}
                >
                  <Text style={[styles.ratingPillText, feelRating === value && styles.ratingPillTextSelected]}>{value}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.logActionRow}>
              <ModeButton
                title="Cancel"
                variant="secondary"
                onPress={() => setIsLogOpen(false)}
                style={styles.logActionButton}
              />
              <ModeButton
                title={isLoggingWorkout ? 'Logging…' : 'End & Log'}
                onPress={handleLogWorkout}
                disabled={isLoggingWorkout}
                style={styles.logActionButton}
              />
            </View>
          </View>
        </View>
      ) : null}
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.bg.primary,
  },
  centerStage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[3],
  },
  loadingScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.bg.primary,
    paddingHorizontal: theme.spacing[3],
  },
  phoneFrame: {
    width: '100%',
    maxWidth: 384,
    alignSelf: 'center',
  },
  questionShell: {
    minHeight: 620,
    justifyContent: 'flex-start',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing[3],
  },
  topBarAction: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface.subtle,
    borderWidth: 1,
    borderColor: theme.colors.border.soft,
  },
  topBarActionDisabled: {
    opacity: 0.45,
  },
  topBarActionPressed: {
    opacity: 0.86,
    transform: [{ scale: 0.97 }],
  },
  skipButton: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing[1],
  },
  skipLabel: {
    color: theme.colors.textMedium,
    ...theme.typography.body2,
    fontFamily: theme.typography.fontFamily,
    fontWeight: '600',
  },
  skipLabelDisabled: {
    color: theme.colors.textDisabled,
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignSelf: 'center',
    gap: 8,
    marginBottom: theme.spacing[4],
  },
  progressDot: {
    height: 8,
    borderRadius: 999,
  },
  iconTile: {
    width: 64,
    height: 64,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing[3],
    alignSelf: 'center',
  },
  questionHeaderBlock: {
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing[3],
  },
  questionHeading: {
    color: theme.colors.textHigh,
    ...theme.typography.h1,
    fontFamily: theme.typography.fontFamily,
    marginBottom: theme.spacing[1],
    textAlign: 'center',
  },
  questionSubtitle: {
    color: theme.colors.textMedium,
    ...theme.typography.body1,
    textAlign: 'center',
    maxWidth: 320,
  },
  optionsList: {
    gap: 12,
  },
  answerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[1],
    minHeight: 78,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: 14,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: theme.colors.border.soft,
    backgroundColor: theme.colors.surface.base,
  },
  answerRowPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.99 }],
  },
  answerTextBlock: {
    flex: 1,
  },
  answerLabel: {
    color: theme.colors.textHigh,
    ...theme.typography.body2,
    fontFamily: theme.typography.fontFamily,
    fontWeight: '700',
    marginBottom: 2,
  },
  answerSublabel: {
    color: theme.colors.textMedium,
    ...theme.typography.body3,
    fontFamily: theme.typography.fontFamily,
  },
  answerCheck: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  answerCheckPlaceholder: {
    width: 26,
    height: 26,
  },
  resultCard: {
    backgroundColor: theme.colors.surface.base,
    borderColor: theme.colors.border.soft,
    borderWidth: 1,
    borderRadius: 28,
    padding: theme.spacing[4],
    marginTop: theme.spacing[4],
  },
  bundleBlock: {
    paddingTop: theme.spacing[2],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border.soft,
    marginTop: theme.spacing[2],
  },
  bundleBlockFirst: {
    paddingTop: 0,
    borderTopWidth: 0,
    marginTop: 0,
  },
  bundleLabel: {
    color: theme.colors.textMedium,
    ...theme.typography.label,
    fontFamily: theme.typography.fontFamily,
    textTransform: 'uppercase',
    marginBottom: theme.spacing[1],
  },
  bundleValue: {
    color: theme.colors.textHigh,
    ...theme.typography.body1,
    fontFamily: theme.typography.fontFamily,
    marginBottom: theme.spacing[1],
  },
  bundleMeta: {
    color: theme.colors.accent,
    ...theme.typography.body2,
    fontFamily: theme.typography.fontFamily,
  },
  bundleActionCard: {
    marginTop: theme.spacing[2],
    minHeight: 84,
  },
  resultsContent: {
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[4],
    alignItems: 'center',
  },
  resultsEyebrow: {
    color: theme.colors.accent,
    ...theme.typography.label,
    fontFamily: theme.typography.fontFamily,
    textTransform: 'uppercase',
  },
  summaryStatusCard: {
    marginTop: theme.spacing[3],
    borderRadius: 22,
    backgroundColor: withAlpha(theme.colors.error, 0.1),
    borderWidth: 1,
    borderColor: withAlpha(theme.colors.error, 0.35),
    padding: theme.spacing[3],
  },
  homeOverviewCard: {
    marginTop: theme.spacing[3],
    borderColor: theme.colors.border.soft,
    backgroundColor: theme.colors.surface.base,
  },
  homeOverviewModeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[2],
  },
  homeOverviewModeLabel: {
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  homeOverviewInfoButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border.soft,
    backgroundColor: theme.colors.surface.subtle,
  },
  homeOverviewInfoButtonPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.96 }],
  },
  homeOverviewModeValue: {
    marginTop: theme.spacing[1],
    fontWeight: '700',
  },
  homeOverviewTitle: {
    marginTop: theme.spacing[2],
  },
  homeOverviewBody: {
    marginTop: theme.spacing[1],
  },
  homeOverviewInfoPanel: {
    marginTop: theme.spacing[3],
    padding: theme.spacing[3],
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.colors.border.soft,
    backgroundColor: theme.colors.surface.subtle,
    gap: theme.spacing[2],
  },
  homeOverviewInfoBody: {
    lineHeight: 20,
  },
  homeOverviewInputHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[2],
  },
  homeOverviewInputList: {
    gap: theme.spacing[2],
  },
  homeOverviewInputRow: {
    gap: 4,
  },
  homeOverviewInputLabel: {
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  homeOverviewInputValue: {
    color: theme.colors.textHigh,
  },
  homeOverviewMindsetWrap: {
    marginTop: theme.spacing[3],
  },
  homeOverviewMindsetValue: {
    marginTop: theme.spacing[1],
    color: theme.colors.textHigh,
  },
  homeOverviewProgressWrap: {
    marginTop: theme.spacing[3],
  },
  homeOverviewProgress: {
    marginTop: theme.spacing[1],
  },
  homeOverviewActions: {
    marginTop: theme.spacing[2],
    gap: theme.spacing[1],
  },
  summaryStatusTitle: {
    color: theme.colors.textHigh,
    ...theme.typography.body2,
    fontFamily: theme.typography.fontFamily,
    fontWeight: '700',
    marginBottom: theme.spacing[1],
  },
  summaryStatusBody: {
    color: theme.colors.error,
    ...theme.typography.body2,
    fontFamily: theme.typography.fontFamily,
  },
  copyFeedback: {
    marginTop: theme.spacing[2],
    ...theme.typography.body3,
    fontFamily: theme.typography.fontFamily,
    fontWeight: '600',
  },
  copyFeedbackSuccess: {
    color: theme.colors.accent,
  },
  copyFeedbackError: {
    color: theme.colors.warning,
  },
  footerButton: {
    width: '100%',
    maxWidth: 384,
    marginTop: theme.spacing[3],
  },
  reviewCard: {
    width: '100%',
    maxWidth: 384,
    borderRadius: 28,
    backgroundColor: theme.colors.surface.base,
    borderWidth: 1,
    borderColor: theme.colors.border.soft,
    padding: theme.spacing[4],
    alignItems: 'center',
  },
  reviewTitle: {
    color: theme.colors.textHigh,
    ...theme.typography.h3,
    fontFamily: theme.typography.fontFamily,
    marginTop: theme.spacing[3],
  },
  reviewBody: {
    color: theme.colors.textMedium,
    ...theme.typography.body2,
    fontFamily: theme.typography.fontFamily,
    textAlign: 'center',
  },
  errorCard: {
    width: '100%',
    maxWidth: 384,
    borderRadius: 28,
    backgroundColor: theme.colors.surface.base,
    borderWidth: 1,
    borderColor: withAlpha(theme.colors.error, 0.34),
    padding: theme.spacing[4],
  },
  errorTitle: {
    color: theme.colors.textHigh,
    ...theme.typography.h3,
    fontFamily: theme.typography.fontFamily,
    marginBottom: theme.spacing[1],
    textAlign: 'center',
  },
  errorText: {
    color: theme.colors.error,
    ...theme.typography.body2,
    fontFamily: theme.typography.fontFamily,
    textAlign: 'center',
  },
  errorButton: {
    marginTop: theme.spacing[3],
  },
  loadingTitle: {
    color: theme.colors.textHigh,
    ...theme.typography.h3,
    fontFamily: theme.typography.fontFamily,
    marginTop: theme.spacing[3],
    marginBottom: theme.spacing[1],
  },
  loadingBody: {
    color: theme.colors.textMedium,
    ...theme.typography.body2,
    fontFamily: theme.typography.fontFamily,
    textAlign: 'center',
    maxWidth: 320,
  },
  glowOrb: {
    position: 'absolute',
    top: -80,
    left: '50%',
    marginLeft: -220,
    width: 440,
    height: 300,
    borderRadius: 220,
    opacity: 0.24,
    transform: [{ scaleX: 1.2 }],
  },
  gridOverlay: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.15,
  },
  gridDot: {
    position: 'absolute',
    width: 2,
    height: 2,
    borderRadius: 1,
    backgroundColor: theme.colors.border.soft,
  },
  planActionCard: {
    minHeight: 92,
    borderRadius: 18,
    borderWidth: 1,
    backgroundColor: theme.colors.surface.base,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
  },
  planActionIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  planActionCopy: {
    flex: 1,
  },
  planActionTitle: {
    color: theme.colors.textHigh,
    ...theme.typography.body2,
    fontFamily: theme.typography.fontFamily,
    fontWeight: '700',
  },
  planActionSubtitle: {
    color: theme.colors.textMedium,
    ...theme.typography.body3,
    fontFamily: theme.typography.fontFamily,
    marginTop: 2,
  },
  planActionArrow: {
    transform: [{ rotate: '-12deg' }],
  },
  previousCard: {
    marginTop: theme.spacing[3],
    borderRadius: 16,
    borderWidth: 1,
    borderColor: withAlpha(theme.colors.accent, 0.35),
    backgroundColor: withAlpha(theme.colors.accent, 0.1),
    padding: theme.spacing[2],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 60,
  },
  previousLoadingText: {
    color: theme.colors.textMedium,
    ...theme.typography.body2,
    fontFamily: theme.typography.fontFamily,
    marginLeft: theme.spacing[2],
  },
  previousLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
    flex: 1,
  },
  previousCopyWrap: {
    flex: 1,
  },
  previousTitle: {
    color: theme.colors.textHigh,
    ...theme.typography.body2,
    fontFamily: theme.typography.fontFamily,
    fontWeight: '700',
  },
  previousMeta: {
    color: theme.colors.textMedium,
    ...theme.typography.body3,
    fontFamily: theme.typography.fontFamily,
    marginTop: 2,
  },
  toggleTrack: {
    width: 42,
    height: 24,
    borderRadius: 999,
    backgroundColor: theme.colors.border.strong,
    padding: 2,
    justifyContent: 'center',
  },
  toggleTrackOn: {
    backgroundColor: withAlpha(theme.colors.accent, 0.4),
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: theme.colors.surface.base,
  },
  toggleThumbOn: {
    alignSelf: 'flex-end',
  },
  sectionHeading: {
    color: theme.colors.textHigh,
    ...theme.typography.body1,
    fontFamily: theme.typography.fontFamily,
    fontWeight: '700',
    marginTop: theme.spacing[3],
    marginBottom: theme.spacing[2],
  },
  environmentGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12,
  },
  environmentCard: {
    width: '48%',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border.soft,
    backgroundColor: theme.colors.surface.base,
    minHeight: 118,
    paddingVertical: 14,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  environmentCardSelected: {
    borderColor: withAlpha(theme.colors.primary, 0.5),
    backgroundColor: withAlpha(theme.colors.primary, 0.12),
  },
  environmentCardPressed: {
    transform: [{ scale: 0.99 }],
  },
  environmentEmoji: {
    fontSize: 20,
    marginBottom: 6,
  },
  environmentLabel: {
    color: theme.colors.textHigh,
    ...theme.typography.body2,
    fontFamily: theme.typography.fontFamily,
    fontWeight: '700',
    textAlign: 'center',
  },
  environmentDesc: {
    color: theme.colors.textMedium,
    ...theme.typography.body3,
    fontFamily: theme.typography.fontFamily,
    marginTop: 4,
    textAlign: 'center',
  },
  timePillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  timePill: {
    borderWidth: 1,
    borderColor: theme.colors.border.soft,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: theme.colors.surface.base,
  },
  timePillSelected: {
    backgroundColor: withAlpha(theme.colors.primary, 0.1),
    borderColor: withAlpha(theme.colors.primary, 0.4),
  },
  timePillText: {
    color: theme.colors.textMedium,
    ...theme.typography.body3,
    fontFamily: theme.typography.fontFamily,
    fontWeight: '600',
  },
  timePillTextSelected: {
    color: theme.colors.primary,
  },
  dayTypeList: {
    gap: 10,
  },
  dayTypeCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border.soft,
    backgroundColor: theme.colors.surface.base,
    padding: theme.spacing[2],
  },
  dayTypeCardSelected: {
    borderColor: withAlpha(theme.colors.primary, 0.5),
    backgroundColor: withAlpha(theme.colors.primary, 0.12),
  },
  dayTypeTitle: {
    color: theme.colors.textHigh,
    ...theme.typography.body2,
    fontFamily: theme.typography.fontFamily,
    fontWeight: '700',
    marginBottom: 4,
  },
  dayTypeBody: {
    color: theme.colors.textMedium,
    ...theme.typography.body3,
    fontFamily: theme.typography.fontFamily,
  },
  nutritionNoteInput: {
    marginTop: theme.spacing[2],
    minHeight: 112,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border.soft,
    backgroundColor: theme.colors.surface.base,
    color: theme.colors.textHigh,
    ...theme.typography.body2,
    fontFamily: theme.typography.fontFamily,
    padding: 12,
  },
  generateButton: {
    backgroundColor: theme.colors.brand.progressCore,
  },
  planStepWrap: {
    flex: 1,
  },
  generatedWorkoutHeaderBar: {
    backgroundColor: 'transparent',
    borderBottomWidth: 0,
  },
  planAdjustButton: {
    minHeight: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border.soft,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface.raised,
    marginTop: 2,
    paddingHorizontal: 10,
    flexDirection: 'row',
    gap: 6,
  },
  planAdjustButtonPressed: {
    opacity: 0.78,
  },
  planAdjustButtonLabel: {
    color: theme.colors.textHigh,
    ...theme.typography.body3,
    fontFamily: theme.typography.fontFamily,
    fontWeight: '600',
  },
  planLoadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: theme.spacing[3],
  },
  planLoadingText: {
    color: theme.colors.textMedium,
    ...theme.typography.body2,
    fontFamily: theme.typography.fontFamily,
    textAlign: 'center',
  },
  typingDotsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  typingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: withAlpha(theme.colors.primary, 0.4),
  },
  planErrorCard: {
    marginHorizontal: theme.spacing[3],
    marginTop: theme.spacing[4],
    borderRadius: 20,
    borderWidth: 1,
    borderColor: withAlpha(theme.colors.error, 0.35),
    backgroundColor: withAlpha(theme.colors.error, 0.08),
    padding: theme.spacing[3],
  },
  planDiagnosticsText: {
    marginTop: theme.spacing[2],
    color: theme.colors.textMedium,
    ...theme.typography.body3,
    fontFamily: theme.typography.fontFamily,
    textAlign: 'center',
  },
  planHintText: {
    marginTop: theme.spacing[1],
    color: theme.colors.textMedium,
    ...theme.typography.body3,
    fontFamily: theme.typography.fontFamily,
    textAlign: 'center',
  },
  debugCard: {
    width: '100%',
    maxWidth: 384,
    alignSelf: 'center',
    marginTop: theme.spacing[3],
    padding: theme.spacing[3],
    borderRadius: 20,
    borderWidth: 1,
    borderColor: withAlpha(theme.colors.textMedium, 0.2),
    backgroundColor: theme.colors.surface.muted,
  },
  debugCardTitle: {
    color: theme.colors.textHigh,
    ...theme.typography.body2,
    fontFamily: theme.typography.fontFamily,
    fontWeight: '700',
    marginBottom: theme.spacing[2],
  },
  debugCardBody: {
    color: theme.colors.textMedium,
    ...theme.typography.body3,
    fontFamily: theme.typography.fontFamily,
    marginBottom: 4,
  },
  debugButtonRow: {
    flexDirection: 'row',
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
  },
  debugButton: {
    flex: 1,
  },
  planScrollContent: {
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    paddingBottom: 120,
    gap: 12,
  },
  trainingHeaderCard: {
    borderRadius: 20,
    backgroundColor: withAlpha(theme.colors.brand.progressSoft, 0.22),
    borderWidth: 1,
    borderColor: withAlpha(theme.colors.brand.progressCore, 0.34),
    padding: theme.spacing[3],
  },
  trainingTitle: {
    color: theme.colors.textHigh,
    ...theme.typography.h3,
    fontFamily: theme.typography.fontFamily,
  },
  trainingDescription: {
    color: theme.colors.textMedium,
    ...theme.typography.body2,
    fontFamily: theme.typography.fontFamily,
    marginTop: 8,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  metaPill: {
    color: theme.colors.textHigh,
    ...theme.typography.body3,
    fontFamily: theme.typography.fontFamily,
    backgroundColor: withAlpha(theme.colors.brand.progressSoft, 0.24),
    borderWidth: 1,
    borderColor: withAlpha(theme.colors.brand.progressCore, 0.35),
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    textTransform: 'capitalize',
  },
  sectionCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border.soft,
    backgroundColor: theme.colors.surface.base,
    padding: theme.spacing[2],
  },
  sectionTitle: {
    color: theme.colors.textHigh,
    ...theme.typography.body1,
    fontFamily: theme.typography.fontFamily,
    fontWeight: '700',
    marginBottom: theme.spacing[2],
  },
  simpleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  simpleDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 10,
  },
  simpleBody: {
    flex: 1,
  },
  simpleName: {
    color: theme.colors.textHigh,
    ...theme.typography.body2,
    fontFamily: theme.typography.fontFamily,
    fontWeight: '600',
  },
  simpleDesc: {
    color: theme.colors.textMedium,
    ...theme.typography.body3,
    fontFamily: theme.typography.fontFamily,
    marginTop: 2,
  },
  simpleDuration: {
    color: theme.colors.textMedium,
    ...theme.typography.body3,
    fontFamily: theme.typography.fontFamily,
  },
  exerciseCard: {
    borderWidth: 1,
    borderColor: theme.colors.border.soft,
    borderRadius: 14,
    backgroundColor: theme.colors.surface.muted,
    marginBottom: 10,
  },
  exerciseTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  exerciseNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(theme.colors.primary, 0.3),
    marginRight: 8,
  },
  exerciseNumberText: {
    color: theme.colors.textHigh,
    ...theme.typography.body3,
    fontFamily: theme.typography.fontFamily,
    fontWeight: '700',
  },
  exerciseBody: {
    flex: 1,
  },
  exerciseName: {
    color: theme.colors.textHigh,
    ...theme.typography.body2,
    fontFamily: theme.typography.fontFamily,
    fontWeight: '700',
  },
  exerciseMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  exerciseChip: {
    color: theme.colors.textMedium,
    ...theme.typography.body3,
    fontFamily: theme.typography.fontFamily,
    backgroundColor: theme.colors.surface.subtle,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  chevronButton: {
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exerciseExpanded: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border.soft,
    padding: 10,
    gap: 8,
  },
  exerciseDetail: {
    color: theme.colors.textMedium,
    ...theme.typography.body3,
    fontFamily: theme.typography.fontFamily,
  },
  coachTipBox: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: withAlpha(theme.colors.brand.progressCore, 0.42),
    backgroundColor: withAlpha(theme.colors.brand.progressSoft, 0.25),
    padding: 8,
  },
  coachTipText: {
    color: theme.colors.textHigh,
    ...theme.typography.body3,
    fontFamily: theme.typography.fontFamily,
  },
  videoPlaceholder: {
    borderRadius: 10,
    backgroundColor: theme.colors.surface.subtle,
    borderWidth: 1,
    borderColor: theme.colors.border.soft,
    minHeight: 72,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  videoPlaceholderText: {
    color: theme.colors.textMedium,
    ...theme.typography.body3,
    fontFamily: theme.typography.fontFamily,
  },
  coachNoteCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: withAlpha(theme.colors.accent, 0.35),
    backgroundColor: withAlpha(theme.colors.accent, 0.12),
    padding: theme.spacing[2],
  },
  coachNoteText: {
    color: theme.colors.textHigh,
    ...theme.typography.body2,
    fontFamily: theme.typography.fontFamily,
    fontStyle: 'italic',
  },
  guidedHeroCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: withAlpha(theme.colors.brand.progressCore, 0.38),
    backgroundColor: withAlpha(theme.colors.brand.progressSoft, 0.24),
    padding: theme.spacing[3],
    alignItems: 'center',
  },
  guidedEyebrow: {
    color: theme.colors.textMedium,
    ...theme.typography.label,
    fontFamily: theme.typography.fontFamily,
    textTransform: 'uppercase',
  },
  guidedTitle: {
    color: theme.colors.textHigh,
    ...theme.typography.h3,
    fontFamily: theme.typography.fontFamily,
    marginTop: 4,
    textAlign: 'center',
  },
  guidedTimer: {
    color: theme.colors.brand.progressCore,
    fontSize: 42,
    fontWeight: '700',
    marginTop: 10,
  },
  guidedStatus: {
    color: theme.colors.textMedium,
    ...theme.typography.body2,
    fontFamily: theme.typography.fontFamily,
    marginTop: 4,
  },
  guidedExerciseRow: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border.soft,
    backgroundColor: theme.colors.surface.base,
    padding: theme.spacing[2],
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bottomCtaBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: theme.spacing[3],
    paddingTop: 10,
    paddingBottom: 16,
    backgroundColor: theme.colors.surface.overlay,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border.soft,
  },
  bottomSingleCtaBar: {
    paddingTop: 12,
  },
  guidedButton: {
    width: '100%',
  },
  guidedButtonPrimary: {
    backgroundColor: theme.colors.brand.progressCore,
  },
  splitRow: {
    flexDirection: 'row',
    gap: 10,
  },
  splitButton: {
    flex: 1,
    borderRadius: 12,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pauseButton: {
    backgroundColor: theme.colors.warning,
  },
  endButton: {
    backgroundColor: theme.colors.brand.progressSuccess,
  },
  splitButtonText: {
    color: theme.colors.text.primary,
    ...theme.typography.body2,
    fontFamily: theme.typography.fontFamily,
    fontWeight: '700',
  },
  logFeedback: {
    color: theme.colors.accent,
    ...theme.typography.body3,
    fontFamily: theme.typography.fontFamily,
    marginTop: 8,
    textAlign: 'center',
  },
  nutritionHeaderCard: {
    borderRadius: 20,
    backgroundColor: withAlpha(theme.colors.brand.progressSoft, 0.2),
    borderWidth: 1,
    borderColor: withAlpha(theme.colors.brand.progressCore, 0.35),
    padding: theme.spacing[3],
  },
  nutritionCoachNote: {
    color: theme.colors.textMedium,
    ...theme.typography.body2,
    fontFamily: theme.typography.fontFamily,
    fontStyle: 'italic',
    marginTop: 8,
  },
  mealCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border.soft,
    backgroundColor: theme.colors.surface.base,
    padding: theme.spacing[2],
    gap: 8,
  },
  mealTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  mealName: {
    color: theme.colors.textHigh,
    ...theme.typography.body1,
    fontFamily: theme.typography.fontFamily,
    fontWeight: '700',
  },
  foodRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  mealNotes: {
    color: theme.colors.textDisabled,
    ...theme.typography.body3,
    fontFamily: theme.typography.fontFamily,
    marginTop: 4,
  },
  logOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(31, 61, 54, 0.24)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing[3],
  },
  logSheet: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border.soft,
    backgroundColor: theme.colors.surface.base,
    padding: theme.spacing[3],
  },
  logSheetTitle: {
    color: theme.colors.textHigh,
    ...theme.typography.h3,
    fontFamily: theme.typography.fontFamily,
    textAlign: 'center',
  },
  feelRatingRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginTop: theme.spacing[3],
  },
  ratingPill: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: theme.colors.border.soft,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface.subtle,
  },
  ratingPillSelected: {
    borderColor: withAlpha(theme.colors.brand.progressCore, 0.52),
    backgroundColor: withAlpha(theme.colors.brand.progressSoft, 0.32),
  },
  ratingPillText: {
    color: theme.colors.textMedium,
    ...theme.typography.body2,
    fontFamily: theme.typography.fontFamily,
    fontWeight: '700',
  },
  ratingPillTextSelected: {
    color: theme.colors.brand.progressDeep,
  },
  logActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: theme.spacing[3],
  },
  logActionButton: {
    flex: 1,
    marginTop: 0,
  },
});

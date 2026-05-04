import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Check } from 'lucide-react-native';

import {
  EmptyState,
  HeaderBar,
  InlineFeedback,
  ModeButton,
  ModeCard,
  ModeChip,
  ModeText,
  SectionHeader,
  SafeScreen,
} from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import { getCheckinProgress } from '../../dailyCheckin/services/checkinApi';

function formatScore(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '--';
  }
  return value.toFixed(1);
}

function formatDateLabel(dateText) {
  if (!dateText) {
    return '--';
  }
  const parsed = new Date(`${dateText}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return dateText;
  }
  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function formatCheckinCount(value) {
  return value === 1 ? '1 check-in' : `${value} check-ins`;
}

function parseDateOnly(dateText) {
  if (!dateText || typeof dateText !== 'string') {
    return null;
  }

  const [year, month, day] = dateText.split('-').map((part) => Number.parseInt(part, 10));
  if (!year || !month || !day) {
    return null;
  }

  const parsed = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateOnly(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatTrendPoints(value) {
  const absoluteValue = Math.abs(Number.isFinite(value) ? value : 0);
  return absoluteValue.toFixed(1).replace(/\.0$/, '');
}

function getScorePhrase(readinessScore) {
  if (typeof readinessScore !== 'number' || Number.isNaN(readinessScore)) {
    return '';
  }

  return ` with your 7-day average at ${formatScore(readinessScore)}`;
}

export function buildWeeklyCheckInDays({
  asOfDate,
  recentCheckins = [],
  totalDays = 7,
} = {}) {
  const safeTotalDays = Number.isFinite(totalDays) && totalDays > 0
    ? Math.floor(totalDays)
    : 7;
  const completedDates = new Set(
    (Array.isArray(recentCheckins) ? recentCheckins : [])
      .map((entry) => entry?.date)
      .filter(Boolean),
  );
  const fallbackDate = Array.isArray(recentCheckins)
    ? recentCheckins.find((entry) => entry?.date)?.date
    : null;
  const endDate = parseDateOnly(asOfDate) || parseDateOnly(fallbackDate) || new Date();
  const startOffset = -(safeTotalDays - 1);

  return Array.from({ length: safeTotalDays }, (_item, index) => {
    const date = formatDateOnly(addDays(endDate, startOffset + index));
    return {
      date,
      completed: completedDates.has(date),
    };
  });
}

export function getReadinessTrendInsight({
  readinessScore,
  weeklyTrend,
} = {}) {
  const trend = Number.isFinite(weeklyTrend) ? weeklyTrend : 0;
  const scorePhrase = getScorePhrase(readinessScore);

  if (trend <= -5) {
    return `Readiness is down ${formatTrendPoints(trend)} points this week${scorePhrase}. Your body may be carrying more fatigue than usual, so today is a good day to prioritize recovery, sleep, and lower-intensity movement.`;
  }

  if (trend >= 5) {
    return `Readiness is up ${formatTrendPoints(trend)} points this week${scorePhrase}. You may be ready to push a little more if training fits the plan.`;
  }

  if (trend <= -1) {
    return `Readiness is slightly down this week${scorePhrase}. Keep intensity controlled and give recovery the same priority as the workout.`;
  }

  if (trend >= 1) {
    return `Readiness is trending up${scorePhrase}. That is a good sign your habits are working, so keep building without forcing extra intensity.`;
  }

  return `Readiness is holding steady${scorePhrase}. Stay consistent and let today's score guide the right effort.`;
}

export function WeeklyCheckInStreak({
  completedCount,
  totalDays = 7,
  completionPercent,
  days = [],
}) {
  const safeTotalDays = Number.isFinite(totalDays) && totalDays > 0
    ? Math.floor(totalDays)
    : 7;
  const visibleDays = Array.from({ length: safeTotalDays }, (_item, index) => (
    days[index] || { date: `day-${index + 1}`, completed: false }
  ));
  const derivedCompletedCount = visibleDays.filter((day) => day.completed).length;
  const safeCompletedCount = Number.isFinite(completedCount)
    ? Math.max(0, Math.min(safeTotalDays, Math.round(completedCount)))
    : derivedCompletedCount;
  const safePercent = Number.isFinite(completionPercent)
    ? Math.round(completionPercent)
    : Math.round((safeCompletedCount / safeTotalDays) * 100);

  return (
    <View testID="weekly-checkin-streak" style={styles.weeklyStreak}>
      <View style={styles.weeklyStreakRow}>
        {visibleDays.map((day, index) => (
          <View
            key={day.date || `day-${index}`}
            testID={`weekly-checkin-day-${index}`}
            accessibilityLabel={`${formatDateLabel(day.date)} check-in ${day.completed ? 'completed' : 'missed'}`}
            style={[
              styles.weeklyStreakCircle,
              day.completed ? styles.weeklyStreakCircleComplete : styles.weeklyStreakCircleMissed,
            ]}
          >
            {day.completed ? (
              <Check
                testID={`weekly-checkin-day-check-${index}`}
                size={11}
                color={theme.colors.text.inverse}
                strokeWidth={3}
              />
            ) : null}
          </View>
        ))}
      </View>
      <ModeText
        testID="weekly-checkin-copy"
        variant="bodySm"
        tone="secondary"
        style={styles.weeklyStreakCopy}
      >
        {`${safePercent}% (${safeCompletedCount} of ${safeTotalDays}) check-ins complete`}
      </ModeText>
    </View>
  );
}

function ReadinessAverageCard({
  label,
  value,
  helper,
  testID,
}) {
  return (
    <View testID={testID} style={styles.averageCard}>
      <ModeText variant="caption" tone="tertiary" style={styles.averageLabel}>
        {label}
      </ModeText>
      <ModeText variant="h2" tone="primary" style={styles.averageValue}>
        {value}
      </ModeText>
      {helper ? (
        <ModeText variant="caption" tone="secondary" style={styles.averageHelper}>
          {helper}
        </ModeText>
      ) : null}
    </View>
  );
}

export default function ProgressScreen({
  accessToken,
  bottomInset = 0,
  onOpenInsights,
  initialSection = 'habits',
}) {
  const [payload, setPayload] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [section, setSection] = useState(initialSection);

  const loadProgress = useCallback(async ({ refresh = false } = {}) => {
    if (!accessToken) {
      return;
    }

    if (refresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    setErrorMessage(null);

    try {
      const result = await getCheckinProgress({ accessToken });
      setPayload(result || null);
    } catch (error) {
      setErrorMessage(error?.message || 'Unable to load progress analytics.');
    } finally {
      if (refresh) {
        setIsRefreshing(false);
      } else {
        setIsLoading(false);
      }
    }
  }, [accessToken]);

  useEffect(() => {
    loadProgress();
  }, [loadProgress]);

  const weeklyCheckInDays = useMemo(() => buildWeeklyCheckInDays({
    asOfDate: payload?.as_of_date,
    recentCheckins: payload?.recent_checkins,
    totalDays: 7,
  }), [payload?.as_of_date, payload?.recent_checkins]);
  const weeklyCompletedCount = useMemo(() => (
    weeklyCheckInDays.filter((day) => day.completed).length
  ), [weeklyCheckInDays]);
  const weeklyCompletionPercent = Math.round((weeklyCompletedCount / 7) * 100);
  const totalCheckinsCount = payload?.total_checkins_count || 0;
  const remainingForThirtyDayAverage = Math.max(0, 30 - totalCheckinsCount);
  const thirtyDayAvailabilityCopy = payload?.has_enough_for_30d
    ? '30-day trend is unlocked and updates with each new check-in.'
    : `${formatCheckinCount(remainingForThirtyDayAverage)} more needed to unlock your 30-day average.`;

  const sevenDayChange = payload?.score_change_7d?.value ?? 0;
  const readinessTrendInsight = getReadinessTrendInsight({
    readinessScore: payload?.avg_score_last_7_days,
    weeklyTrend: sevenDayChange,
  });

  return (
    <SafeScreen includeTopInset={false} style={styles.screen} atmosphere="home">
      <HeaderBar title="Progress" subtitle="Check-ins, readiness, and recovery-aware trends" />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: theme.spacing[4] + bottomInset }]}
        refreshControl={(
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => loadProgress({ refresh: true })}
            tintColor={theme.colors.accent.primary}
          />
        )}
      >
        <View style={styles.tabRow}>
          <ModeChip
            label="Habits"
            selected={section === 'habits'}
            onPress={() => setSection('habits')}
          />
          <ModeChip
            label="Insights"
            selected={section === 'insights'}
            onPress={() => {
              setSection('insights');
              if (typeof onOpenInsights === 'function') {
                onOpenInsights();
              }
            }}
          />
        </View>

        {isLoading ? (
          <ModeCard variant="tinted" style={styles.centerCard}>
            <ActivityIndicator size="small" color={theme.colors.accent.primary} />
            <ModeText variant="bodySm" tone="secondary">Loading your trend signals...</ModeText>
          </ModeCard>
        ) : null}

        {!isLoading && errorMessage ? (
          <>
            <InlineFeedback type="error" message={errorMessage} />
            <ModeButton variant="secondary" title="Retry" onPress={() => loadProgress()} />
          </>
        ) : null}

        {!isLoading && !errorMessage && payload ? (
          <>
            <ModeCard variant="hero" style={styles.summaryCard}>
              <SectionHeader
                title="Weekly check-in streak"
                style={styles.summaryHeader}
              />
              <WeeklyCheckInStreak
                completedCount={weeklyCompletedCount}
                completionPercent={weeklyCompletionPercent}
                days={weeklyCheckInDays}
              />
            </ModeCard>

            <ModeCard variant="tinted">
              <ModeText variant="h3">Readiness scores</ModeText>
              <ModeText
                testID="readiness-trend-insight"
                variant="bodySm"
                tone="secondary"
                style={styles.readinessInsight}
              >
                {readinessTrendInsight}
              </ModeText>
              <View style={styles.metricRowGlass}>
                <ReadinessAverageCard
                  testID="readiness-average-7d"
                  label="7-day average"
                  value={formatScore(payload.avg_score_last_7_days)}
                  helper={payload.avg_mode_last_7_days || 'Builds after your first week of check-ins.'}
                />
                <ReadinessAverageCard
                  testID="readiness-average-30d"
                  label="30-day average"
                  value={formatScore(payload.avg_score_last_30_days)}
                  helper={payload.avg_mode_last_30_days || thirtyDayAvailabilityCopy}
                />
              </View>
              <ModeText variant="bodySm" tone="secondary" style={styles.readinessFooter}>
                Your readiness averages summarize recent daily check-in scores so you can spot short-term and long-term trends.
              </ModeText>
            </ModeCard>

            <ModeButton
              title="Open Coach Insights"
              onPress={onOpenInsights}
            />
          </>
        ) : null}

        {!isLoading && !errorMessage && !payload ? (
          <EmptyState
            title="No progress yet"
            body="Complete your first check-in to start seeing habits and readiness trends."
            ctaLabel="Refresh"
            onPress={() => loadProgress()}
          />
        ) : null}
      </ScrollView>
    </SafeScreen>
  );
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
  tabRow: {
    flexDirection: 'row',
    gap: theme.spacing[1],
  },
  centerCard: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[1],
  },
  summaryCard: {
    marginBottom: 0,
  },
  summaryHeader: {
    marginBottom: theme.spacing[1],
  },
  weeklyStreak: {
    alignItems: 'center',
    gap: theme.spacing[2],
  },
  weeklyStreakCopy: {
    textAlign: 'center',
  },
  weeklyStreakRow: {
    width: '100%',
    maxWidth: 280,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[1],
  },
  weeklyStreakCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weeklyStreakCircleComplete: {
    backgroundColor: theme.colors.accent.primary,
    borderColor: theme.colors.glass.borderActive,
  },
  weeklyStreakCircleMissed: {
    backgroundColor: theme.colors.surface.base,
    borderColor: theme.colors.border.soft,
  },
  readinessInsight: {
    marginTop: theme.spacing[1],
  },
  metricRowGlass: {
    marginTop: theme.spacing[2],
    flexDirection: 'row',
    gap: theme.spacing[2],
  },
  averageCard: {
    flex: 1,
    minHeight: 104,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: theme.spacing[1],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.radii.s,
    borderWidth: 1,
    borderColor: theme.colors.border.soft,
    backgroundColor: theme.colors.surface.base,
  },
  averageLabel: {
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  averageValue: {
    textAlign: 'center',
    fontWeight: '700',
  },
  averageHelper: {
    textAlign: 'center',
  },
  readinessFooter: {
    marginTop: theme.spacing[2],
  },
});

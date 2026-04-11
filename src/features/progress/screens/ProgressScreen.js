import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import {
  EmptyState,
  HeaderBar,
  InlineFeedback,
  ModeButton,
  ModeCard,
  ModeChip,
  ModeText,
  ProgressBar,
  SafeScreen,
  StreakRing,
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

function clampToPercent(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function formatCheckinCount(value) {
  return value === 1 ? '1 check-in' : `${value} check-ins`;
}

const HABIT_ITEMS = [
  { key: 'movement', label: 'Movement done' },
  { key: 'protein', label: 'Protein anchor hit' },
  { key: 'sleep', label: 'Sleep target protected' },
];

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
  const [habitState, setHabitState] = useState({
    movement: false,
    protein: false,
    sleep: false,
  });

  const loadProgress = async ({ refresh = false } = {}) => {
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
  };

  useEffect(() => {
    loadProgress();
  }, [accessToken]);

  const consistencyRatio = useMemo(() => {
    return clampToPercent((payload?.checkins_last_7_days || 0) / 7);
  }, [payload?.checkins_last_7_days]);
  const totalCheckinsCount = payload?.total_checkins_count || 0;
  const remainingForThirtyDayAverage = Math.max(0, 30 - totalCheckinsCount);
  const thirtyDayAvailabilityCopy = payload?.has_enough_for_30d
    ? '30-day trend is unlocked and updates with each new check-in.'
    : `${formatCheckinCount(remainingForThirtyDayAverage)} more needed to unlock your 30-day average.`;

  const sevenDayChange = payload?.score_change_7d?.value || 0;
  const changeFeedback = sevenDayChange >= 0
    ? `Weekly readiness trend: +${Math.abs(sevenDayChange).toFixed(1)} (steady or improving).`
    : `Weekly readiness trend: ${sevenDayChange.toFixed(1)} (recovery support recommended).`;

  return (
    <SafeScreen includeTopInset={false} style={styles.screen}>
      <HeaderBar title="Progress" subtitle="Consistency, habits, and recovery-aware trends" />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: theme.spacing[4] + bottomInset }]}
        refreshControl={(
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => loadProgress({ refresh: true })}
            tintColor={theme.colors.brand.progressCore}
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
            <ActivityIndicator size="small" color={theme.colors.brand.progressCore} />
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
            <ModeCard variant="surface" style={styles.summaryCard}>
              <View style={styles.summaryTopRow}>
                <StreakRing value={payload.current_streak_days || 0} label="days" />
                <View style={styles.summaryCopy}>
                  <ModeText variant="h3">Current check-in streak</ModeText>
                  <ModeText variant="label" tone="tertiary" style={styles.summarySectionLabel}>
                    Weekly consistency
                  </ModeText>
                  <ModeText variant="bodySm" tone="secondary" style={styles.summarySectionMeta}>
                    {payload.checkins_last_7_days || 0} of 7 check-ins complete
                  </ModeText>
                  <ProgressBar
                    progress={consistencyRatio}
                    trackColor="#EFEDE6"
                    fillColor={theme.colors.brand.progressCore}
                    style={styles.progressBar}
                  />
                </View>
              </View>
            </ModeCard>

            <InlineFeedback
              type={sevenDayChange >= 0 ? 'success' : 'warning'}
              message={changeFeedback}
            />

            <ModeCard variant="tinted">
              <ModeText variant="h3">Readiness scores</ModeText>
              <View style={styles.metricRow}>
                <View style={styles.metricCell}>
                  <ModeText variant="caption" tone="tertiary">7-day average</ModeText>
                  <ModeText variant="h2">{formatScore(payload.avg_score_last_7_days)}</ModeText>
                  <ModeText variant="bodySm" tone="secondary">
                    {payload.avg_mode_last_7_days || 'Builds after your first week of check-ins.'}
                  </ModeText>
                </View>
                <View style={styles.metricCell}>
                  <ModeText variant="caption" tone="tertiary">30-day average</ModeText>
                  <ModeText variant="h2">{formatScore(payload.avg_score_last_30_days)}</ModeText>
                  <ModeText variant="bodySm" tone="secondary">
                    {payload.avg_mode_last_30_days || thirtyDayAvailabilityCopy}
                  </ModeText>
                </View>
              </View>
              <ModeText variant="bodySm" tone="secondary" style={styles.readinessFooter}>
                Your readiness averages summarize recent daily check-in scores so you can spot short-term and long-term trends.
              </ModeText>
            </ModeCard>

            <ModeCard variant="surface">
              <ModeText variant="h3">Weekly consistency chart</ModeText>
              <View style={styles.chartRow}>
                {(payload.recent_checkins || []).slice(0, 7).reverse().map((entry) => {
                  const normalized = clampToPercent((entry.score || 0) / 25);
                  return (
                    <View key={`${entry.date}-${entry.score}`} style={styles.chartItem}>
                      <View style={styles.chartBarTrack}>
                        <View style={[styles.chartBarFill, { height: `${Math.max(10, normalized * 100)}%` }]} />
                      </View>
                      <ModeText variant="caption" tone="tertiary">{formatDateLabel(entry.date)}</ModeText>
                    </View>
                  );
                })}
              </View>
              <ModeText variant="bodySm" tone="secondary" style={styles.chartFooter}>
                Each bar shows one recent day&apos;s readiness score from a completed check-in. If a day is missing, no check-in was logged for that date.
              </ModeText>
            </ModeCard>

            <ModeCard variant="tinted">
              <ModeText variant="h3">Today&apos;s quick wins</ModeText>
              <ModeText variant="bodySm" tone="secondary" style={styles.habitIntro}>
                Use these as a lightweight session checklist. They do not save or affect your streak, readiness averages, or coach insights yet.
              </ModeText>

              <View style={styles.habitList}>
                {HABIT_ITEMS.map((item) => {
                  const isDone = habitState[item.key];
                  return (
                    <Pressable
                      key={item.key}
                      style={[styles.habitRow, isDone && styles.habitRowDone]}
                      onPress={() => {
                        setHabitState((previous) => ({
                          ...previous,
                          [item.key]: !previous[item.key],
                        }));
                      }}
                    >
                      <ModeText variant="bodySm" tone={isDone ? 'accent' : 'secondary'}>{item.label}</ModeText>
                      <View style={[styles.habitToggle, isDone && styles.habitToggleDone]} />
                    </Pressable>
                  );
                })}
              </View>
            </ModeCard>

            <ModeButton
              variant="secondary"
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
    backgroundColor: theme.colors.surface.canvas,
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
  summaryTopRow: {
    flexDirection: 'row',
    gap: theme.spacing[2],
    alignItems: 'center',
  },
  summaryCopy: {
    flex: 1,
  },
  summarySectionLabel: {
    marginTop: theme.spacing[1],
  },
  summarySectionMeta: {
    marginTop: theme.spacing[1],
    marginBottom: theme.spacing[2],
  },
  progressBar: {
    marginTop: theme.spacing[1],
  },
  metricRow: {
    marginTop: theme.spacing[2],
    flexDirection: 'row',
    gap: theme.spacing[2],
  },
  metricCell: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.colors.border.soft,
    borderRadius: theme.radii.s,
    backgroundColor: theme.colors.surface.base,
    padding: theme.spacing[2],
  },
  readinessFooter: {
    marginTop: theme.spacing[2],
  },
  chartRow: {
    marginTop: theme.spacing[2],
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 6,
  },
  chartItem: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  chartBarTrack: {
    width: '100%',
    maxWidth: 24,
    height: 72,
    borderRadius: 12,
    backgroundColor: '#EFEDE6',
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  chartBarFill: {
    width: '100%',
    borderRadius: 12,
    backgroundColor: theme.colors.brand.progressCore,
  },
  chartFooter: {
    marginTop: theme.spacing[2],
  },
  habitIntro: {
    marginTop: theme.spacing[1],
  },
  habitList: {
    marginTop: theme.spacing[2],
    gap: theme.spacing[1],
  },
  habitRow: {
    borderWidth: 1,
    borderColor: theme.colors.border.soft,
    borderRadius: theme.radii.s,
    backgroundColor: theme.colors.surface.base,
    minHeight: 48,
    paddingHorizontal: theme.spacing[2],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  habitRowDone: {
    borderColor: 'rgba(76, 175, 125, 0.42)',
    backgroundColor: 'rgba(76, 175, 125, 0.1)',
  },
  habitToggle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: theme.colors.border.strong,
    backgroundColor: theme.colors.surface.subtle,
  },
  habitToggleDone: {
    borderColor: theme.colors.brand.progressSuccess,
    backgroundColor: theme.colors.brand.progressSuccess,
  },
});

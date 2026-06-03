import React from 'react';
import { StyleSheet, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';

import { ModeText } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import { STREAK_MILESTONES } from '../config/metricConfig';

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

// Maps JS getDay() (Sun=0) to M-S index (Mon=0, Sun=6)
function getTodayIndex() {
  return (new Date().getDay() + 6) % 7;
}

function DayBar({ daysThisWeek, daysTarget }) {
  const total = daysTarget || 7;
  const todayIndex = getTodayIndex();

  return (
    <View style={styles.dayBarContainer}>
      <View style={styles.daySegments}>
        {DAY_LABELS.slice(0, total).map((label, i) => {
          const done = i < daysThisWeek;
          const isToday = i === todayIndex;
          return (
            <View key={i} style={styles.daySegmentWrap}>
              <View
                style={[
                  styles.daySegment,
                  done && styles.daySegmentDone,
                  !done && isToday && styles.daySegmentToday,
                ]}
              />
              <ModeText variant="caption" tone="tertiary" style={styles.dayLabel}>
                {label}
              </ModeText>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function MilestoneTiles({ currentWeeks, milestoneNext }) {
  return (
    <View style={styles.tilesRow}>
      {STREAK_MILESTONES.map((m) => {
        const reached = currentWeeks >= m.weeks;
        const isNext = m.weeks === milestoneNext;
        return (
          <View
            key={m.weeks}
            style={[
              styles.tile,
              reached && styles.tileReached,
              !reached && isNext && styles.tileNext,
            ]}
          >
            <ModeText variant="label" tone={reached ? 'success' : isNext ? 'accent' : 'tertiary'} style={styles.tileWeeks}>
              {m.label}
            </ModeText>
            <ModeText variant="caption" tone={reached ? 'success' : isNext ? 'accent' : 'disabled'} style={styles.tileStatus}>
              {reached ? 'reached' : isNext ? 'next' : ''}
            </ModeText>
          </View>
        );
      })}
    </View>
  );
}

function OutcomeCard() {
  return (
    <View style={styles.outcomeCard}>
      <Feather name="trending-up" size={14} color={theme.colors.accent.primary} style={styles.outcomeIcon} />
      <ModeText variant="caption" tone="secondary" style={styles.outcomeText}>
        Your readiness has{' '}
        <ModeText variant="caption" tone="primary" style={styles.outcomeBold}>
          improved since you started this streak
        </ModeText>
        . Consistent check-ins help your coach calibrate your plan more accurately.
      </ModeText>
    </View>
  );
}

export function StreakSection({ streak }) {
  if (!streak) {
    return null;
  }

  const { current_weeks, days_this_week, days_target, personal_best_weeks, milestone_next } = streak;
  const isPersonalBest = current_weeks > 0 && current_weeks >= personal_best_weeks;

  return (
    <View style={styles.container} accessibilityRole="summary" accessibilityLabel="Streak summary">
      {/* Hero row — days this week is primary, streak week badge is secondary */}
      <View style={styles.heroRow}>
        <View style={styles.heroLeft}>
          <ModeText variant="display" tone="primary" style={styles.heroNumber}>
            {days_this_week}
          </ModeText>
          <ModeText variant="body2" tone="tertiary" style={styles.heroSuffix}>
            {' '}of {days_target || 7} days this week
          </ModeText>
        </View>
        {current_weeks > 0 ? (
          <View style={styles.streakBadge}>
            <ModeText variant="label" tone="tertiary" style={styles.streakBadgeText}>
              {current_weeks}w streak
            </ModeText>
          </View>
        ) : (
          <ModeText variant="caption" tone="tertiary">Start your streak</ModeText>
        )}
      </View>

      {/* Day bar */}
      <DayBar daysThisWeek={days_this_week} daysTarget={days_target} />

      {/* Milestone tiles */}
      <MilestoneTiles currentWeeks={current_weeks} milestoneNext={milestone_next} />

      {/* Outcome card — shown once streak reaches 2 weeks */}
      {current_weeks >= 2 ? <OutcomeCard /> : null}

      {/* Personal best row */}
      {personal_best_weeks > 0 ? (
        <View style={styles.pbRow}>
          <ModeText variant="caption" tone="tertiary">personal best</ModeText>
          <View style={styles.pbRight}>
            <ModeText variant="caption" tone="primary" style={styles.pbValue}>
              {personal_best_weeks} weeks
            </ModeText>
            {isPersonalBest ? (
              <View style={styles.pbBadge}>
                <ModeText variant="label" style={styles.pbBadgeText}>current streak</ModeText>
              </View>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    gap: theme.spacing[3],
  },

  // Hero
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heroLeft: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexShrink: 1,
    gap: 0,
  },
  heroNumber: {
    fontSize: 48,
    fontWeight: '600',
    lineHeight: 52,
  },
  heroSuffix: {
    marginBottom: 4,
  },
  streakBadge: {
    backgroundColor: theme.colors.glass.base,
    borderRadius: theme.radii.pill,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 4,
    marginLeft: theme.spacing[2],
    flexShrink: 0,
  },
  streakBadgeText: {
    fontSize: 11,
  },

  // Day bar
  dayBarContainer: {
    gap: 0,
  },
  daySegments: {
    flexDirection: 'row',
    gap: 4,
  },
  daySegmentWrap: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  daySegment: {
    width: '100%',
    height: 6,
    borderRadius: theme.radii.pill,
    backgroundColor: theme.colors.glass.borderSoft,
  },
  daySegmentDone: {
    backgroundColor: theme.colors.accent.primary,
    opacity: 0.75,
  },
  daySegmentToday: {
    backgroundColor: theme.colors.glass.borderDefault,
  },
  dayLabel: {
    fontSize: 10,
    textAlign: 'center',
  },

  // Milestone tiles
  tilesRow: {
    flexDirection: 'row',
    gap: 6,
  },
  tile: {
    flex: 1,
    backgroundColor: theme.colors.surface.elevated,
    borderRadius: theme.radii.xs,
    borderWidth: 1,
    borderColor: theme.colors.border?.soft ?? theme.colors.glass.borderSoft,
    paddingVertical: theme.spacing[1],
    paddingHorizontal: 4,
    alignItems: 'center',
    gap: 2,
  },
  tileReached: {
    borderColor: theme.colors.status.success,
    backgroundColor: 'rgba(95,158,127,0.07)',
  },
  tileNext: {
    borderColor: theme.colors.glass.borderActive,
    backgroundColor: theme.colors.accent.soft,
  },
  tileWeeks: {
    fontSize: 12,
    fontWeight: '600',
  },
  tileStatus: {
    fontSize: 10,
    letterSpacing: 0.2,
  },

  // Outcome card
  outcomeCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing[1],
    backgroundColor: theme.colors.accent.soft,
    borderWidth: 1,
    borderColor: theme.colors.glass.borderActive,
    borderRadius: theme.radii.s,
    padding: theme.spacing[2],
  },
  outcomeIcon: {
    flexShrink: 0,
    marginTop: 1,
  },
  outcomeText: {
    flex: 1,
    lineHeight: 18,
  },
  outcomeBold: {
    fontWeight: '600',
  },

  // Personal best
  pbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: theme.spacing[1],
    borderTopWidth: 1,
    borderTopColor: theme.colors.glass.borderSoft,
  },
  pbRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pbValue: {
    fontWeight: '500',
  },
  pbBadge: {
    backgroundColor: theme.colors.accent.soft,
    borderWidth: 1,
    borderColor: theme.colors.accent.primary,
    borderRadius: theme.radii.pill,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  pbBadgeText: {
    color: theme.colors.accent.primary,
    fontSize: 10,
    letterSpacing: 0.5,
  },
});

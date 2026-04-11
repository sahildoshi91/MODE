import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import {
  EmptyState,
  HeaderBar,
  InlineFeedback,
  ModeCard,
  ModeText,
  SafeScreen,
  StateBadge,
} from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import { getCheckinProgress } from '../../dailyCheckin/services/checkinApi';

function inferPattern(payload) {
  const streak = payload?.current_streak_days || 0;
  const consistency = payload?.checkins_last_7_days || 0;
  const change = payload?.score_change_7d?.value || 0;

  if (streak >= 5 && consistency >= 5 && change >= 0) {
    return 'Your consistency trend is strong and stable this week.';
  }

  if (consistency <= 2) {
    return 'Your rhythm looks interrupted this week; low-friction steps will help restart momentum.';
  }

  if (change < 0) {
    return 'Readiness is trending down slightly. A recovery-led adjustment can protect momentum.';
  }

  return 'You are maintaining a workable baseline; small repeated actions will compound well.';
}

function inferAdjustment(payload) {
  const mode = payload?.avg_mode_last_7_days || null;
  const consistency = payload?.checkins_last_7_days || 0;

  if (consistency <= 2) {
    return 'Shrink today to one essential action and one recovery anchor.';
  }

  if (mode === 'REST' || mode === 'RECOVER') {
    return 'Prioritize recovery quality and one structured routine action before adding intensity.';
  }

  return 'Keep your current cadence and add one focused progression in training or nutrition.';
}

function inferNextAction(payload) {
  const streak = payload?.current_streak_days || 0;
  const consistency = payload?.checkins_last_7_days || 0;

  if (streak === 0 || consistency <= 1) {
    return 'Complete a 10-minute reset block today and log your check-in by evening.';
  }

  if (streak >= 7) {
    return 'Protect your streak with a sustainable BASE day and sleep-first recovery.';
  }

  return 'Lock one non-negotiable workout or meal anchor, then close the day with a reflection note.';
}

export default function CoachInsightsScreen({ accessToken, onBack, bottomInset = 0 }) {
  const [payload, setPayload] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadInsights = async () => {
    if (!accessToken) {
      setPayload(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await getCheckinProgress({ accessToken });
      setPayload(result || null);
    } catch (requestError) {
      setError(requestError?.message || 'Unable to load coach insights right now.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadInsights();
  }, [accessToken]);

  const sections = useMemo(() => {
    if (!payload) {
      return [];
    }

    return [
      {
        title: 'Pattern observed',
        body: inferPattern(payload),
      },
      {
        title: 'Suggested adjustment',
        body: inferAdjustment(payload),
      },
      {
        title: 'Next best action',
        body: inferNextAction(payload),
      },
    ];
  }, [payload]);

  return (
    <SafeScreen style={styles.screen}>
      <HeaderBar
        title="Coach Insights"
        subtitle="Calm signals from your recent check-ins"
        onBack={onBack}
        backAccessibilityLabel="Go back"
      />

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: theme.spacing[4] + bottomInset }]}>
        {isLoading ? (
          <ModeCard variant="tinted" style={styles.loadingCard}>
            <ActivityIndicator size="small" color={theme.colors.brand.progressCore} />
            <ModeText variant="bodySm" tone="secondary">Generating insight cards...</ModeText>
          </ModeCard>
        ) : null}

        {!isLoading && error ? (
          <InlineFeedback type="error" message={error} />
        ) : null}

        {!isLoading && !error && payload ? (
          <>
            <ModeCard variant="surface">
              <ModeText variant="label" tone="tertiary">Current context</ModeText>
              <View style={styles.badgeRow}>
                <StateBadge mode={payload.avg_mode_last_7_days || 'RECOVER'} />
              </View>
              <ModeText variant="bodySm" tone="secondary" style={styles.contextLine}>
                {payload.current_streak_days || 0} day streak • {payload.checkins_last_7_days || 0}/7 check-ins this week
              </ModeText>
            </ModeCard>

            {sections.map((section) => (
              <ModeCard key={section.title} variant="tinted">
                <ModeText variant="h3">{section.title}</ModeText>
                <ModeText variant="bodySm" tone="secondary" style={styles.sectionBody}>{section.body}</ModeText>
                <ModeText variant="caption" tone="tertiary" style={styles.confidence}>
                  Confidence: based on your recent readiness and consistency signals.
                </ModeText>
              </ModeCard>
            ))}
          </>
        ) : null}

        {!isLoading && !error && !payload ? (
          <EmptyState
            title="No insights yet"
            body="Complete a few check-ins and your coach will start surfacing personalized patterns."
            ctaLabel="Refresh"
            onPress={loadInsights}
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
  loadingCard: {
    alignItems: 'center',
    gap: theme.spacing[1],
  },
  badgeRow: {
    marginTop: theme.spacing[1],
  },
  contextLine: {
    marginTop: theme.spacing[2],
  },
  sectionBody: {
    marginTop: theme.spacing[1],
  },
  confidence: {
    marginTop: theme.spacing[2],
  },
});

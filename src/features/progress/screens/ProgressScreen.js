import React from 'react';
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
  ModeText,
  SafeScreen,
  SectionHeader,
} from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import { MetricRow } from '../components/MetricRow';
import { StreakSection } from '../components/StreakSection';
import { METRIC_ORDER } from '../config/metricConfig';
import { useProgressMetrics } from '../hooks/useProgressMetrics';

export default function ProgressScreen({
  accessToken,
  bottomInset = 0,
  onOpenMetricDetail,
}) {
  const { data, loading, refreshing, error, refresh, reload } = useProgressMetrics({ accessToken });

  const handleMetricPress = (dimensionKey) => {
    if (typeof onOpenMetricDetail === 'function' && data?.metrics?.[dimensionKey]) {
      onOpenMetricDetail(dimensionKey, data.metrics[dimensionKey]);
    }
  };

  return (
    <SafeScreen includeTopInset={false} style={styles.screen} atmosphere="home">
      <HeaderBar title="Progress" subtitle="Check-ins, readiness, and recovery-aware trends" />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: theme.spacing[4] + bottomInset }]}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={theme.colors.accent.primary}
          />
        )}
      >
        {loading ? (
          <ModeCard variant="tinted" style={styles.centerCard}>
            <ActivityIndicator size="small" color={theme.colors.accent.primary} />
            <ModeText variant="bodySm" tone="secondary">Loading your metrics...</ModeText>
          </ModeCard>
        ) : null}

        {!loading && error ? (
          <>
            <InlineFeedback type="error" message={error} />
            <ModeButton variant="secondary" title="Retry" onPress={() => reload()} />
          </>
        ) : null}

        {!loading && !error && data ? (
          <>
            <SectionHeader title="Your metrics · 7-day" style={styles.sectionHeader} />
            <View style={styles.metricList}>
              {METRIC_ORDER.map((key, index) => {
                const dim = data.metrics?.[key];
                if (!dim) {
                  return null;
                }
                return (
                  <React.Fragment key={key}>
                    <MetricRow
                      dimensionKey={key}
                      dimension={dim}
                      onPress={() => handleMetricPress(key)}
                    />
                    {index < METRIC_ORDER.length - 1 ? (
                      <View style={styles.divider} />
                    ) : null}
                  </React.Fragment>
                );
              })}
            </View>

            <ModeCard variant="tinted" style={styles.streakCard}>
              <SectionHeader title="Check-in streak" style={styles.sectionHeader} />
              <StreakSection streak={data.streak} />
            </ModeCard>
          </>
        ) : null}

        {!loading && !error && !data ? (
          <EmptyState
            title="No check-ins yet"
            body="Complete your first check-in to start seeing habits and readiness trends."
            ctaLabel="Refresh"
            onPress={() => reload()}
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
    paddingTop: theme.spacing[3],
    gap: theme.spacing[2],
  },
  centerCard: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[1],
    marginHorizontal: theme.spacing[3],
  },
  sectionHeader: {
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[1],
  },
  metricList: {
    marginHorizontal: theme.spacing[3],
  },
  divider: {
    height: 1,
    backgroundColor: theme.colors.glass.borderSoft,
    marginLeft: theme.spacing[4],
  },
  streakCard: {
    marginHorizontal: theme.spacing[3],
    paddingHorizontal: 0,
    paddingVertical: 0,
    overflow: 'hidden',
  },
});

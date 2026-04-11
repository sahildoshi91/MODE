import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { HeaderBar, ModeCard, SafeScreen } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import { getCheckinProgress } from '../../dailyCheckin/services/checkinApi';
import { getApiDebugInfo } from '../../../services/apiBaseUrl';
import { getApiRequestDebugState } from '../../../services/apiRequest';

function formatScore(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '--';
  }
  return value.toFixed(2);
}

function formatChange(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '--';
  }
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}`;
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

export default function ProgressScreen({ accessToken, bottomInset = 0 }) {
  const [payload, setPayload] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [errorDiagnostics, setErrorDiagnostics] = useState(null);

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
    setErrorDiagnostics(null);

    try {
      const result = await getCheckinProgress({ accessToken });
      setPayload(result || null);
    } catch (error) {
      setErrorMessage(error?.message || 'Unable to load progress analytics.');
      const apiDebug = getApiDebugInfo();
      const requestDebug = getApiRequestDebugState();
      const candidateHosts = Array.isArray(error?.attempted_base_urls) && error.attempted_base_urls.length > 0
        ? error.attempted_base_urls.join(', ')
        : Array.isArray(requestDebug?.lastAttemptedBaseUrls) && requestDebug.lastAttemptedBaseUrls.length > 0
          ? requestDebug.lastAttemptedBaseUrls.join(', ')
          : null;
      setErrorDiagnostics({
        status: error?.status || null,
        requestId: error?.request_id || null,
        apiBaseUrl: error?.api_base_url || error?.resolved_api_base_url || apiDebug.resolvedApiBaseUrl || null,
        attemptedHosts: candidateHosts,
      });
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

  const analyticsRows = useMemo(() => {
    if (!payload) {
      return [];
    }

    const rows = [
      {
        metric: 'Current streak',
        value: `${payload.current_streak_days || 0} days`,
        change: '--',
      },
      {
        metric: 'Last 7-day consistency',
        value: `${payload.checkins_last_7_days || 0} / 7`,
        change: '--',
      },
      {
        metric: 'Avg score (7 days)',
        value: payload.avg_score_last_7_days != null
          ? `${formatScore(payload.avg_score_last_7_days)} (${payload.avg_mode_last_7_days || '--'})`
          : '--',
        change: formatChange(payload.score_change_7d?.value),
      },
      {
        metric: '7-day score change',
        value: formatChange(payload.score_change_7d?.value),
        change: payload.score_change_7d?.has_previous_window_data
          ? `Prev: ${formatScore(payload.score_change_7d?.previous_average)}`
          : 'No prior window',
      },
    ];

    if (payload.has_enough_for_30d) {
      rows.push(
        {
          metric: 'Avg score (30 days)',
          value: payload.avg_score_last_30_days != null
            ? `${formatScore(payload.avg_score_last_30_days)} (${payload.avg_mode_last_30_days || '--'})`
            : '--',
          change: '--',
        },
        {
          metric: '30-day score change',
          value: formatChange(payload.score_change_30d?.value),
          change: payload.score_change_30d?.has_previous_window_data
            ? `Prev: ${formatScore(payload.score_change_30d?.previous_average)}`
            : 'No prior window',
        },
      );
    }

    return rows;
  }, [payload]);

  return (
    <SafeScreen style={styles.screen}>
      <HeaderBar title="Progress" subtitle="Check-in analytics and trends" />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: theme.spacing[4] + bottomInset }]}
        refreshControl={(
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => loadProgress({ refresh: true })}
            tintColor={theme.colors.textHigh}
          />
        )}
      >
        {isLoading ? (
          <ModeCard style={styles.centerCard}>
            <ActivityIndicator size="small" color={theme.colors.accent} />
            <Text style={styles.loadingText}>Loading progress analytics...</Text>
          </ModeCard>
        ) : null}

        {!isLoading && errorMessage ? (
          <ModeCard style={styles.centerCard}>
            <Text style={styles.errorTitle}>Unable to load progress</Text>
            <Text style={styles.errorBody}>{errorMessage}</Text>
            {__DEV__ && errorDiagnostics ? (
              <View style={styles.errorDiagnosticsWrap}>
                <Text style={styles.errorDiagnosticsText}>Status: {errorDiagnostics.status || '--'}</Text>
                <Text style={styles.errorDiagnosticsText}>Request ID: {errorDiagnostics.requestId || '--'}</Text>
                <Text style={styles.errorDiagnosticsText}>API Base: {errorDiagnostics.apiBaseUrl || '--'}</Text>
                <Text style={styles.errorDiagnosticsText}>Attempted Hosts: {errorDiagnostics.attemptedHosts || '--'}</Text>
              </View>
            ) : null}
            <Pressable style={styles.retryButton} onPress={() => loadProgress()}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </ModeCard>
        ) : null}

        {!isLoading && !errorMessage && payload ? (
          <>
            <ModeCard style={styles.tableCard}>
              <Text style={styles.sectionTitle}>Analytics</Text>
              <View style={styles.tableHeaderRow}>
                <Text style={[styles.headerCell, styles.metricCol]}>Metric</Text>
                <Text style={[styles.headerCell, styles.valueCol]}>Value</Text>
                <Text style={[styles.headerCell, styles.changeCol]}>Change</Text>
              </View>
              {analyticsRows.map((row) => (
                <View key={row.metric} style={styles.tableRow}>
                  <Text style={[styles.metricCell, styles.metricCol]}>{row.metric}</Text>
                  <Text style={[styles.valueCell, styles.valueCol]}>{row.value}</Text>
                  <Text style={[styles.changeCell, styles.changeCol]}>{row.change}</Text>
                </View>
              ))}

              {!payload.has_enough_for_30d ? (
                <View style={styles.noticeBlock}>
                  <Text style={styles.noticeLabel}>30-day analytics</Text>
                  <Text style={styles.noticeText}>{payload.insufficient_data_reason || 'Not enough data yet.'}</Text>
                </View>
              ) : null}
            </ModeCard>

            <ModeCard style={styles.tableCard}>
              <Text style={styles.sectionTitle}>Recent check-ins</Text>
              <View style={styles.tableHeaderRow}>
                <Text style={[styles.headerCell, styles.metricCol]}>Date</Text>
                <Text style={[styles.headerCell, styles.valueCol]}>Score</Text>
                <Text style={[styles.headerCell, styles.changeCol]}>Mode</Text>
              </View>
              {(payload.recent_checkins || []).map((row) => (
                <View key={`${row.date}-${row.score}`} style={styles.tableRow}>
                  <Text style={[styles.metricCell, styles.metricCol]}>{formatDateLabel(row.date)}</Text>
                  <Text style={[styles.valueCell, styles.valueCol]}>{row.score}</Text>
                  <Text style={[styles.changeCell, styles.changeCol]}>{row.mode}</Text>
                </View>
              ))}

              {(payload.recent_checkins || []).length === 0 ? (
                <Text style={styles.emptyHint}>No check-ins yet.</Text>
              ) : null}
            </ModeCard>
          </>
        ) : null}
      </ScrollView>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: theme.colors.bg.primary,
  },
  content: {
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[3],
    gap: theme.spacing[2],
  },
  centerCard: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[1],
  },
  loadingText: {
    color: theme.colors.textMedium,
    ...theme.typography.body2,
    fontFamily: theme.typography.fontFamily,
  },
  errorTitle: {
    color: theme.colors.error,
    ...theme.typography.h3,
    fontFamily: theme.typography.fontFamily,
  },
  errorBody: {
    color: theme.colors.textMedium,
    ...theme.typography.body2,
    fontFamily: theme.typography.fontFamily,
    marginTop: theme.spacing[1],
    textAlign: 'center',
  },
  errorDiagnosticsWrap: {
    marginTop: theme.spacing[1],
    width: '100%',
    padding: theme.spacing[1],
    borderRadius: theme.radii.s,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    gap: 2,
  },
  errorDiagnosticsText: {
    color: theme.colors.textMedium,
    ...theme.typography.body3,
    fontFamily: theme.typography.fontFamily,
  },
  retryButton: {
    marginTop: theme.spacing[2],
    borderRadius: theme.radii.m,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.28)',
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  retryText: {
    color: theme.colors.textHigh,
    ...theme.typography.button,
    fontFamily: theme.typography.fontFamily,
  },
  tableCard: {
    backgroundColor: '#161A22',
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  sectionTitle: {
    color: theme.colors.textHigh,
    ...theme.typography.h3,
    fontFamily: theme.typography.fontFamily,
    marginBottom: theme.spacing[2],
  },
  tableHeaderRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.14)',
    paddingBottom: theme.spacing[1],
    marginBottom: theme.spacing[1],
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
    paddingVertical: theme.spacing[1],
  },
  metricCol: {
    flex: 1.5,
    paddingRight: theme.spacing[1],
  },
  valueCol: {
    flex: 1,
    paddingRight: theme.spacing[1],
  },
  changeCol: {
    flex: 1,
  },
  headerCell: {
    color: 'rgba(255, 255, 255, 0.7)',
    ...theme.typography.label,
    fontFamily: theme.typography.fontFamily,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  metricCell: {
    color: theme.colors.textMedium,
    ...theme.typography.body2,
    fontFamily: theme.typography.fontFamily,
  },
  valueCell: {
    color: theme.colors.textHigh,
    ...theme.typography.body2,
    fontFamily: theme.typography.fontFamily,
    fontWeight: '600',
  },
  changeCell: {
    color: theme.colors.textMedium,
    ...theme.typography.body3,
    fontFamily: theme.typography.fontFamily,
  },
  noticeBlock: {
    marginTop: theme.spacing[2],
    borderRadius: theme.radii.s,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    padding: theme.spacing[2],
  },
  noticeLabel: {
    color: theme.colors.textHigh,
    ...theme.typography.label,
    fontFamily: theme.typography.fontFamily,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  noticeText: {
    color: theme.colors.textMedium,
    ...theme.typography.body2,
    fontFamily: theme.typography.fontFamily,
    marginTop: theme.spacing[1],
  },
  emptyHint: {
    color: theme.colors.textMedium,
    ...theme.typography.body2,
    fontFamily: theme.typography.fontFamily,
    marginTop: theme.spacing[1],
  },
});

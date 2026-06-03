import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  ModeButton,
  ModeText,
  SafeScreen,
  SectionHeader,
} from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import { CoachInsightCard } from '../components/CoachInsightCard';
import { MetricBarChart } from '../components/MetricBarChart';
import { MetricExplainer } from '../components/MetricExplainer';
import { METRIC_CONFIG, SIGNAL_LABELS } from '../config/metricConfig';
import { getProgressMetrics } from '../services/progressApi';

const DAY_ABBREVS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function buildDayLabels() {
  const today = new Date();
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (6 - i));
    return DAY_ABBREVS[d.getDay()];
  });
}

function PlainHeader({ insetTop, onBack }) {
  return (
    <View style={[styles.header, { paddingTop: insetTop + theme.spacing[2] }]}>
      <Pressable
        style={styles.iconButton}
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <Feather name="chevron-left" size={20} color={theme.colors.text.tertiary} />
      </Pressable>
      <ModeText variant="body2" tone="tertiary" style={styles.breadcrumb}>Progress</ModeText>
      <View style={styles.iconButtonPlaceholder} />
    </View>
  );
}

function PeriodToggle({ period, onChange }) {
  return (
    <View style={styles.periodToggle}>
      {[7, 30].map((p) => (
        <Pressable
          key={p}
          style={[styles.periodBtn, period === p && styles.periodBtnActive]}
          onPress={() => onChange(p)}
          hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={`${p}-day period`}
          accessibilityState={{ selected: period === p }}
        >
          <ModeText
            variant="label"
            style={[styles.periodBtnText, period === p && styles.periodBtnTextActive]}
          >
            {p}D
          </ModeText>
        </Pressable>
      ))}
    </View>
  );
}

function statusColor(status) {
  if (status === 'good') {
    return theme.colors.status.success;
  }
  if (status === 'flagged') {
    return theme.colors.status.error;
  }
  return theme.colors.status.warning;
}

function statusLabel(status) {
  if (status === 'good') {
    return 'Good';
  }
  if (status === 'flagged') {
    return 'Flagged';
  }
  return 'Watch';
}

function signalDotColor(value) {
  if (value >= 4) {
    return theme.colors.status.success;
  }
  if (value >= 3) {
    return theme.colors.status.warning;
  }
  return theme.colors.status.error;
}

function SignalList({ signals }) {
  if (!signals || signals.length === 0) {
    return null;
  }

  return (
    <View style={styles.signalList}>
      {signals.map((signal, i) => {
        const rawVal = signal.current_value;
        const labelStr = rawVal !== null && rawVal !== undefined
          ? (SIGNAL_LABELS[rawVal] || String(rawVal))
          : '—';
        const dotColor = rawVal !== null && rawVal !== undefined
          ? signalDotColor(rawVal)
          : theme.colors.text.disabled;

        return (
          <View key={i} style={styles.signalRow}>
            <View style={styles.signalLeft}>
              <View style={[styles.signalDot, { backgroundColor: dotColor }]} />
              <ModeText variant="body2" tone="secondary">{signal.label}</ModeText>
            </View>
            <View style={styles.signalRight}>
              <ModeText variant="body2" tone="primary" style={styles.signalValue}>
                {rawVal !== null && rawVal !== undefined ? `${labelStr} (${rawVal}/5)` : labelStr}
              </ModeText>
              {signal.week_note ? (
                <ModeText variant="caption" tone="tertiary" style={styles.weekNote}>
                  {signal.week_note}
                </ModeText>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

export default function MetricDrillDownScreen({
  accessToken,
  dimensionKey,
  initialDimension,
  onBack,
  bottomInset = 0,
}) {
  const config = METRIC_CONFIG[dimensionKey];
  const { width: windowWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const chartWidth = windowWidth - theme.spacing[3] * 2;
  const [period, setPeriod] = useState(7);
  const [dimension, setDimension] = useState(initialDimension || null);
  const [loading, setLoading] = useState(!initialDimension);
  const [error, setError] = useState(null);

  const loadForPeriod = useCallback(async (p) => {
    if (!accessToken) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await getProgressMetrics({ accessToken, periodDays: p });
      const dim = result?.metrics?.[dimensionKey];
      if (dim) {
        setDimension(dim);
      }
    } catch (err) {
      setError(err?.message || 'Unable to load metric details.');
    } finally {
      setLoading(false);
    }
  }, [accessToken, dimensionKey]);

  useEffect(() => {
    if (period !== 7 || !initialDimension) {
      loadForPeriod(period);
    }
  }, [period, loadForPeriod, initialDimension]);

  const handlePeriodChange = (p) => {
    setPeriod(p);
  };

  if (!config) {
    return null;
  }

  const heroMax = config.unit === '/25' ? 25 : 5;
  const heroSubtitle = dimension
    ? `${Math.round(dimension.surface_value_raw ?? 0)} of ${heroMax} · ${period}D avg`
    : null;

  const dotColor = dimension ? statusColor(dimension.status) : theme.colors.text.disabled;
  const statusText = dimension ? statusLabel(dimension.status) : '';

  // Day-of-week labels for 7D chart
  const xLabels = period === 7 ? buildDayLabels() : null;

  return (
    <SafeScreen includeTopInset={false} style={styles.screen} atmosphere="home">
      <PlainHeader insetTop={insets.top} onBack={onBack} />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: theme.spacing[4] + bottomInset }]}
      >
        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={theme.colors.accent.primary} />
            <ModeText variant="bodySm" tone="secondary">Loading...</ModeText>
          </View>
        ) : null}

        {!loading && error ? (
          <View style={styles.errorBlock}>
            <ModeText variant="body2" style={styles.errorText}>{error}</ModeText>
            <ModeButton variant="secondary" title="Retry" onPress={() => loadForPeriod(period)} />
          </View>
        ) : null}

        {!loading && dimension ? (
          <>
            {/* Hero block — status dot + label above metric name */}
            <View style={styles.heroBlock}>
              <View style={styles.statusRow}>
                <View style={[styles.statusDot, { backgroundColor: dotColor }]} />
                <ModeText variant="label" style={[styles.statusLabel, { color: dotColor }]}>
                  {statusText}
                </ModeText>
              </View>
              <ModeText variant="display" tone="primary" style={styles.heroTitle}>
                {config.label}
              </ModeText>
              {heroSubtitle ? (
                <ModeText variant="body2" tone="tertiary" style={styles.heroSubtitle}>
                  {heroSubtitle}
                </ModeText>
              ) : null}
            </View>

            {/* Chart section — "Daily score" label left, toggle right */}
            <View style={styles.chartBlock}>
              <View style={styles.chartHeader}>
                <ModeText variant="caption" tone="tertiary" style={styles.chartHeaderLabel}>
                  Daily score
                </ModeText>
                <PeriodToggle period={period} onChange={handlePeriodChange} />
              </View>
              <MetricBarChart
                sparkline={dimension.sparkline}
                status={dimension.status}
                width={chartWidth}
                height={80}
                xLabels={xLabels}
                highlightToday
                maxValue={config.unit === '/25' ? 25 : 5}
              />
              {period !== 7 ? (
                <View style={[styles.chartLabels, { width: chartWidth }]}>
                  <ModeText variant="caption" tone="tertiary">{period}d ago</ModeText>
                  <ModeText variant="caption" tone="accent" style={styles.todayLabel}>today</ModeText>
                </View>
              ) : null}
            </View>

            {/* Signals — "From your check-ins this week" */}
            {dimension.signals && dimension.signals.length > 0 ? (
              <View style={styles.section}>
                <SectionHeader title="From your check-ins this week" />
                <SignalList signals={dimension.signals} />
              </View>
            ) : null}

            {dimension.coach_insight_triggered ? (
              <View style={styles.section}>
                <CoachInsightCard reason={dimension.coach_insight_reason} />
              </View>
            ) : null}

            <View style={styles.section}>
              <MetricExplainer description={config.description} />
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: theme.colors.background.app,
  },

  // Plain header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.colors.glass.base,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonPlaceholder: {
    width: 36,
    height: 36,
  },
  breadcrumb: {
    flex: 1,
    textAlign: 'center',
  },

  content: {
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[3],
    gap: theme.spacing[3],
  },

  // Hero
  heroBlock: {
    gap: 4,
    paddingTop: theme.spacing[1],
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  heroTitle: {
    ...theme.typography.display,
  },
  heroSubtitle: {
    letterSpacing: 0.1,
  },

  // Chart
  chartBlock: {
    gap: 6,
  },
  chartHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  chartHeaderLabel: {
    flex: 1,
    letterSpacing: 0.3,
  },
  chartLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginTop: 2,
  },
  todayLabel: {
    color: theme.colors.accent.primary,
  },

  // Period toggle
  periodToggle: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    backgroundColor: theme.colors.glass.base,
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    borderColor: theme.colors.glass.borderSoft,
    overflow: 'hidden',
  },
  periodBtn: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
  },
  periodBtnActive: {
    backgroundColor: theme.colors.accent.soft,
  },
  periodBtnText: {
    color: theme.colors.text.muted,
    letterSpacing: 0.4,
  },
  periodBtnTextActive: {
    color: theme.colors.accent.primary,
  },

  // Signals
  section: {
    gap: theme.spacing[2],
  },
  signalList: {
    gap: theme.spacing[2],
  },
  signalRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: theme.spacing[2],
    paddingVertical: 2,
  },
  signalLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  signalDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
    marginTop: 3,
  },
  signalRight: {
    alignItems: 'flex-end',
    gap: 2,
  },
  signalValue: {
    fontWeight: '600',
    textAlign: 'right',
  },
  weekNote: {
    textAlign: 'right',
    letterSpacing: 0.1,
  },

  // Loading / error
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[4],
  },
  errorBlock: {
    gap: theme.spacing[2],
    alignItems: 'center',
    paddingVertical: theme.spacing[3],
  },
  errorText: {
    color: theme.colors.status.error,
    textAlign: 'center',
  },
});

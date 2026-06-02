import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';

import {
  HeaderBar,
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

function PeriodToggle({ period, onChange }) {
  return (
    <View style={styles.periodToggle}>
      {[7, 30].map((p) => (
        <TouchableOpacity
          key={p}
          style={[styles.periodBtn, period === p && styles.periodBtnActive]}
          onPress={() => onChange(p)}
          activeOpacity={0.7}
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
        </TouchableOpacity>
      ))}
    </View>
  );
}

function StatusBadge({ status }) {
  const color = status === 'good'
    ? theme.colors.status.success
    : status === 'flagged'
      ? theme.colors.status.error
      : theme.colors.status.warning;
  const label = status === 'good' ? 'Good' : status === 'flagged' ? 'Flagged' : 'Watch';

  return (
    <View style={[styles.statusBadge, { borderColor: color }]}>
      <View style={[styles.statusDot, { backgroundColor: color }]} />
      <ModeText variant="label" style={[styles.statusLabel, { color }]}>
        {label}
      </ModeText>
    </View>
  );
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
                {labelStr}{' '}
                <ModeText variant="body2" tone="tertiary">({rawVal}/5)</ModeText>
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

  const heroSubtitle = dimension
    ? (() => {
        const firstSignal = dimension.signals?.[0];
        const rawLabel = firstSignal
          ? firstSignal.label.toLowerCase()
          : config.subtitle.replace(' signal', '').replace(' combined', '');
        const rawVal = Math.round(dimension.surface_value_raw ?? 0);
        if (config.unit === '/25') {
          return `${rawLabel} · ${rawVal} of 25 · ${period}D avg`;
        }
        return `${rawLabel} · raw ${rawVal} of 5 · today`;
      })()
    : null;

  const heroValueColor = dimension?.status === 'flagged'
    ? theme.colors.status.error
    : dimension?.status === 'watch'
      ? theme.colors.status.warning
      : theme.colors.text.primary;

  return (
    <SafeScreen includeTopInset={false} style={styles.screen} atmosphere="home">
      <HeaderBar
        title={config.label}
        onBack={onBack}
        backAccessibilityLabel={`Back from ${config.label}`}
      />

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
            {/* Hero block — left-aligned, status badge top-right */}
            <View style={styles.heroBlock}>
              <View style={styles.heroLeft}>
                <ModeText variant="h1" style={[styles.heroValue, { color: heroValueColor }]}>
                  {dimension.surface_value}
                </ModeText>
                {heroSubtitle ? (
                  <ModeText variant="body2" tone="tertiary" style={styles.heroSubtitle}>
                    {heroSubtitle}
                  </ModeText>
                ) : null}
              </View>
              <StatusBadge status={dimension.status} />
            </View>

            <PeriodToggle period={period} onChange={handlePeriodChange} />

            {/* Bar chart */}
            <View style={styles.chartBlock}>
              <SectionHeader title={`Last ${period} days`} style={styles.chartSectionHeader} />
              <MetricBarChart
                sparkline={dimension.sparkline}
                status={dimension.status}
                width={chartWidth}
                height={80}
              />
              <View style={[styles.chartLabels, { width: chartWidth }]}>
                <ModeText variant="caption" tone="tertiary">{period}d ago</ModeText>
                <ModeText variant="caption" tone="accent" style={styles.todayLabel}>today</ModeText>
              </View>
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
  content: {
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[3],
    gap: theme.spacing[3],
  },

  // Hero
  heroBlock: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingTop: theme.spacing[2],
  },
  heroLeft: {
    flex: 1,
    gap: 4,
    paddingRight: theme.spacing[2],
  },
  heroValue: {
    ...theme.typography.display,
    fontWeight: '700',
  },
  heroSubtitle: {
    letterSpacing: 0.1,
  },

  // Status badge
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[0],
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    marginTop: 4,
  },
  statusDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  statusLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.4,
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

  // Chart
  chartBlock: {
    gap: 6,
  },
  chartSectionHeader: {
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 2,
  },
  chartLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  todayLabel: {
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

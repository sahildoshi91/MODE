import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { theme } from '../../theme';
import { GlassCard, GlassSurface } from './GlassSurface';

function clampProgress(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

export function ProgressRing({
  value = 0,
  size = 88,
  strokeWidth = 8,
  label = 'streak',
  centerValue,
  accentColor = theme.colors.accent.primary,
  trackColor = 'rgba(219, 232, 255, 0.16)',
  style,
  testID,
}) {
  const normalized = clampProgress(value);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progressLength = circumference * normalized;

  return (
    <View testID={testID} style={[styles.ringWrap, style]}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={trackColor}
          strokeWidth={strokeWidth}
          fill="transparent"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={accentColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${progressLength} ${circumference}`}
          fill="transparent"
          rotation="-90"
          originX={size / 2}
          originY={size / 2}
        />
      </Svg>
      <View style={styles.ringCenter}>
        <Text style={styles.ringValueText}>{centerValue ?? Math.round(normalized * 100)}</Text>
        <Text style={styles.ringLabelText}>{label}</Text>
      </View>
    </View>
  );
}

export function MacroBar({
  progress = 0,
  label,
  valueLabel,
  accentColor = theme.colors.accent.primary,
  style,
  testID,
}) {
  const normalized = clampProgress(progress);
  return (
    <View testID={testID} style={[styles.macroWrap, style]}>
      {(label || valueLabel) ? (
        <View style={styles.macroHeader}>
          {label ? <Text style={styles.macroLabel}>{label}</Text> : <View />}
          {valueLabel ? <Text style={styles.macroValue}>{valueLabel}</Text> : null}
        </View>
      ) : null}
      <GlassSurface
        state="default"
        radius="pill"
        padding={0}
        highlight={false}
        style={styles.macroTrack}
        contentStyle={styles.macroTrackContent}
      >
        <View style={[styles.macroFill, { width: `${normalized * 100}%`, backgroundColor: accentColor }]} />
      </GlassSurface>
    </View>
  );
}

export function MiniStat({
  label,
  value,
  helper,
  style,
  testID,
}) {
  return (
    <GlassCard
      testID={testID}
      style={[styles.miniStat, style]}
      state="default"
      padding={theme.spacing[2]}
      radius="m"
    >
      <Text style={styles.miniLabel}>{label}</Text>
      <Text style={styles.miniValue}>{value}</Text>
      {helper ? <Text style={styles.miniHelper}>{helper}</Text> : null}
    </GlassCard>
  );
}

export function SectionHeader({
  title,
  subtitle,
  action,
  style,
  testID,
}) {
  return (
    <View testID={testID} style={[styles.sectionHeader, style]}>
      <View style={styles.sectionCopy}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
      </View>
      {action ? <View style={styles.sectionAction}>{action}</View> : null}
    </View>
  );
}

export function EmptyStateGlassPanel({
  title,
  body,
  action,
  style,
  testID,
}) {
  return (
    <GlassCard
      testID={testID}
      style={[styles.emptyPanel, style]}
      state="muted"
      radius="l"
    >
      <Text style={styles.emptyTitle}>{title}</Text>
      {body ? <Text style={styles.emptyBody}>{body}</Text> : null}
      {action ? <View style={styles.emptyAction}>{action}</View> : null}
    </GlassCard>
  );
}

export function HeroOverlayCard({
  eyebrow,
  title,
  body,
  children,
  style,
  testID,
}) {
  return (
    <GlassCard
      testID={testID}
      state="hero"
      radius="l"
      padding={theme.spacing[3]}
      style={[styles.heroCard, style]}
      blur="hero"
    >
      {eyebrow ? <Text style={styles.heroEyebrow}>{eyebrow}</Text> : null}
      {title ? <Text style={styles.heroTitle}>{title}</Text> : null}
      {body ? <Text style={styles.heroBody}>{body}</Text> : null}
      {children}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  ringWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringCenter: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringValueText: {
    color: theme.colors.text.primary,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.h3.fontSize,
    lineHeight: theme.typography.h3.lineHeight,
    fontWeight: '600',
  },
  ringLabelText: {
    color: theme.colors.text.tertiary,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.body3.fontSize,
    lineHeight: theme.typography.body3.lineHeight,
    textTransform: 'uppercase',
    letterSpacing: 0.45,
  },
  macroWrap: {
    width: '100%',
    gap: theme.spacing[1],
  },
  macroHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  macroLabel: {
    color: theme.colors.text.secondary,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.body3.fontSize,
    lineHeight: theme.typography.body3.lineHeight,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  macroValue: {
    color: theme.colors.text.primary,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.body3.fontSize,
    lineHeight: theme.typography.body3.lineHeight,
    fontWeight: '600',
  },
  macroTrack: {
    width: '100%',
    height: 10,
  },
  macroTrackContent: {
    padding: 0,
    justifyContent: 'center',
  },
  macroFill: {
    height: 2.5,
    borderRadius: 2,
  },
  miniStat: {
    marginBottom: 0,
    flex: 1,
  },
  miniLabel: {
    color: theme.colors.text.tertiary,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.body3.fontSize,
    lineHeight: theme.typography.body3.lineHeight,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  miniValue: {
    marginTop: 2,
    color: theme.colors.text.primary,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.h3.fontSize,
    lineHeight: theme.typography.h3.lineHeight,
    fontWeight: '600',
  },
  miniHelper: {
    marginTop: 2,
    color: theme.colors.text.secondary,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.body3.fontSize,
    lineHeight: theme.typography.body3.lineHeight,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: theme.spacing[2],
  },
  sectionCopy: {
    flex: 1,
  },
  sectionTitle: {
    color: theme.colors.text.primary,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.h3.fontSize,
    lineHeight: theme.typography.h3.lineHeight,
    fontWeight: '700',
    letterSpacing: 0.06,
  },
  sectionSubtitle: {
    marginTop: 2,
    color: theme.colors.text.secondary,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.body2.fontSize,
    lineHeight: theme.typography.body2.lineHeight,
  },
  sectionAction: {
    marginBottom: 2,
  },
  emptyPanel: {
    marginBottom: 0,
    alignItems: 'center',
  },
  emptyTitle: {
    textAlign: 'center',
    color: theme.colors.text.primary,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.h3.fontSize,
    lineHeight: theme.typography.h3.lineHeight,
    fontWeight: '600',
  },
  emptyBody: {
    marginTop: theme.spacing[1],
    textAlign: 'center',
    color: theme.colors.text.secondary,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.body2.fontSize,
    lineHeight: theme.typography.body2.lineHeight,
  },
  emptyAction: {
    marginTop: theme.spacing[2],
  },
  heroCard: {
    marginBottom: 0,
    ...theme.shadows.medium,
  },
  heroEyebrow: {
    textTransform: 'uppercase',
    letterSpacing: 0.42,
    color: theme.colors.text.secondary,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.body3.fontSize,
    lineHeight: theme.typography.body3.lineHeight,
    fontWeight: '600',
  },
  heroTitle: {
    marginTop: 4,
    color: theme.colors.text.primary,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.h2.fontSize,
    lineHeight: theme.typography.h2.lineHeight,
    fontWeight: '700',
  },
  heroBody: {
    marginTop: theme.spacing[1],
    color: theme.colors.text.secondary,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.body2.fontSize,
    lineHeight: theme.typography.body2.lineHeight,
  },
});

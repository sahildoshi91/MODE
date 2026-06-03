import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Feather from '@expo/vector-icons/Feather';

import {
  GlassSurface,
  GlassToggle,
  HeaderBar,
  ModeText,
  SafeScreen,
} from '../../../../lib/components';
import { theme } from '../../../../lib/theme';

export function SettingsScreenShell({
  title,
  subtitle,
  onBack = null,
  bottomInset = 0,
  children,
}) {
  return (
    <SafeScreen
      includeTopInset={false}
      style={styles.screen}
      atmosphere="system"
      atmosphereOverlayStrength={0.94}
    >
      <HeaderBar
        title={title}
        subtitle={subtitle}
        onBack={onBack}
      />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: theme.spacing[4] + bottomInset },
        ]}
      >
        {children}
      </ScrollView>
    </SafeScreen>
  );
}

export function SettingsSectionLabel({ children }) {
  return (
    <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>
      {children}
    </ModeText>
  );
}

export function SettingsDetailRow({
  label,
  value,
  testID,
  valueStyle,
}) {
  return (
    <View style={styles.detailRow} testID={testID}>
      <ModeText variant="bodySm" tone="secondary">{label}</ModeText>
      <ModeText variant="bodySm" style={[styles.detailValue, valueStyle]}>{value}</ModeText>
    </View>
  );
}

export function SettingsDivider() {
  return (
    <LinearGradient
      colors={['transparent', theme.colors.border.soft, 'transparent']}
      locations={[0, 0.5, 1]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={styles.divider}
    />
  );
}

export function SettingsNavDivider() {
  return <View style={styles.navDivider} />;
}

function SettingsBadge({ label, variant }) {
  const colors = variant === 'warning'
    ? { bg: theme.colors.feedback.warningBg, border: theme.colors.feedback.warningBorder, text: theme.colors.status.warning }
    : { bg: theme.colors.feedback.successBg, border: theme.colors.feedback.successBorder, text: theme.colors.status.success };
  return (
    <View style={[styles.pill, { backgroundColor: colors.bg, borderColor: colors.border }]}>
      <ModeText variant="caption" style={[styles.pillText, { color: colors.text }]}>{label}</ModeText>
    </View>
  );
}

export function SettingsNavRow({
  title,
  subtitle = null,
  badge = null,
  badgeVariant = 'success',
  onPress,
  titleStyle,
  testID,
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => [
        styles.navRow,
        pressed && styles.navRowPressed,
      ]}
    >
      <View style={styles.navRowCopy}>
        <ModeText variant="bodySm" style={[styles.navRowTitle, titleStyle]}>{title}</ModeText>
        {subtitle ? (
          <ModeText variant="caption" tone="secondary" numberOfLines={1}>{subtitle}</ModeText>
        ) : null}
      </View>
      <View style={styles.navRowTrailing}>
        {badge ? <SettingsBadge label={badge} variant={badgeVariant} /> : null}
        <Feather name="chevron-right" size={14} color={theme.colors.text.tertiary} />
      </View>
    </Pressable>
  );
}

export function SettingToggle({
  label,
  description,
  enabled,
  onToggle,
  testID,
}) {
  return (
    <GlassSurface
      testID={testID}
      state={enabled ? 'active' : 'default'}
      radius="s"
      padding={theme.spacing[2]}
      onPress={onToggle}
      highlight={false}
      style={[
        styles.toggleRow,
        enabled && styles.toggleRowEnabled,
      ]}
      contentStyle={styles.toggleRowContent}
      fillColor={enabled ? theme.colors.nav.activeBg : theme.colors.glass.base}
      borderColor={enabled ? theme.colors.nav.activeBorder : theme.colors.glass.borderDefault}
    >
      <View style={styles.toggleCopy}>
        <ModeText variant="bodySm">{label}</ModeText>
        <ModeText variant="caption" tone="secondary">{description}</ModeText>
      </View>
      <View pointerEvents="none">
        <GlassToggle value={enabled} onValueChange={() => {}} />
      </View>
    </GlassSurface>
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
  sectionLabel: {
    textTransform: 'uppercase',
    letterSpacing: 1.0,
    marginBottom: theme.spacing[2],
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[2],
  },
  detailValue: {
    flex: 1,
    textAlign: 'right',
  },
  divider: {
    height: 1,
    marginVertical: theme.spacing[2],
  },
  toggleRow: {
    minHeight: 56,
    marginBottom: theme.spacing[1],
  },
  toggleRowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[2],
  },
  toggleRowEnabled: {
    borderColor: theme.colors.glass.borderActive,
  },
  toggleCopy: {
    flex: 1,
  },
  navDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.border.soft,
    marginHorizontal: 14,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: theme.spacing[2],
  },
  navRowPressed: {
    backgroundColor: theme.colors.surface.elevated,
    borderRadius: theme.radii.xs,
  },
  navRowCopy: {
    flex: 1,
    gap: 2,
  },
  navRowTitle: {
    fontSize: 13.5,
    fontWeight: '500',
  },
  navRowTrailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: theme.radii.pill,
    borderWidth: 1,
  },
  pillText: {
    fontSize: 11,
    fontWeight: '600',
  },
});

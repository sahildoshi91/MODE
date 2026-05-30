import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

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
  return <View style={styles.divider} />;
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
    backgroundColor: theme.colors.border.soft,
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
});

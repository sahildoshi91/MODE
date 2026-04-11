import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Constants from 'expo-constants';

import {
  ModeButton,
  ModeCard,
  ModeText,
  SafeScreen,
} from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import { getApiDebugInfo } from '../../../services/apiBaseUrl';

function valueOrFallback(value, fallback = 'Not available') {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  return fallback;
}

function SettingToggle({ label, description, enabled, onToggle }) {
  return (
    <Pressable style={[styles.toggleRow, enabled && styles.toggleRowEnabled]} onPress={onToggle}>
      <View style={styles.toggleCopy}>
        <ModeText variant="bodySm">{label}</ModeText>
        <ModeText variant="caption" tone="secondary">{description}</ModeText>
      </View>
      <View style={[styles.toggleTrack, enabled && styles.toggleTrackEnabled]}>
        <View style={[styles.toggleThumb, enabled && styles.toggleThumbEnabled]} />
      </View>
    </Pressable>
  );
}

export default function ProfileScreen({ session, assignmentStatus, onSignOut, bottomInset = 0 }) {
  const debugInfo = useMemo(() => getApiDebugInfo(), []);
  const email = valueOrFallback(session?.user?.email, 'No email found');
  const trainerName = valueOrFallback(assignmentStatus?.assigned_trainer_display_name, 'No trainer assigned');
  const appVersion = valueOrFallback(Constants.expoConfig?.version, 'dev');
  const environment = __DEV__ ? 'Development' : 'Production';

  const [tonePreference, setTonePreference] = useState(true);
  const [reminderPreference, setReminderPreference] = useState(true);

  return (
    <SafeScreen style={styles.screen}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: theme.spacing[4] + bottomInset },
        ]}
      >
        <View style={styles.headerBlock}>
          <ModeText variant="display">Settings</ModeText>
          <ModeText variant="bodySm" tone="secondary">Personalization and account details</ModeText>
        </View>

        <ModeCard variant="surface">
          <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>Account</ModeText>
          <View style={styles.row}>
            <ModeText variant="bodySm" tone="secondary">Email</ModeText>
            <ModeText variant="bodySm">{email}</ModeText>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <ModeText variant="bodySm" tone="secondary">Coach</ModeText>
            <ModeText variant="bodySm">{trainerName}</ModeText>
          </View>
        </ModeCard>

        <ModeCard variant="tinted">
          <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>Personalization</ModeText>
          <SettingToggle
            label="Supportive coaching tone"
            description="Keep language calm, clear, and emotionally intelligent."
            enabled={tonePreference}
            onToggle={() => setTonePreference((current) => !current)}
          />
          <SettingToggle
            label="Gentle progress reminders"
            description="Use low-pressure nudges focused on consistency."
            enabled={reminderPreference}
            onToggle={() => setReminderPreference((current) => !current)}
          />
        </ModeCard>

        <ModeCard variant="surface">
          <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>Diagnostics</ModeText>
          <View style={styles.row}>
            <ModeText variant="bodySm" tone="secondary">Environment</ModeText>
            <ModeText variant="bodySm">{environment}</ModeText>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <ModeText variant="bodySm" tone="secondary">Version</ModeText>
            <ModeText variant="bodySm">{appVersion}</ModeText>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <ModeText variant="bodySm" tone="secondary">API Base</ModeText>
            <ModeText variant="bodySm" style={styles.apiText}>{valueOrFallback(debugInfo.resolvedApiBaseUrl)}</ModeText>
          </View>
        </ModeCard>

        <ModeButton
          title="Sign out"
          variant="destructive"
          onPress={onSignOut}
          size="lg"
        />
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
    paddingTop: theme.spacing[4],
    gap: theme.spacing[2],
  },
  headerBlock: {
    marginBottom: theme.spacing[1],
  },
  sectionLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: theme.spacing[2],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[2],
  },
  divider: {
    height: 1,
    backgroundColor: theme.colors.border.soft,
    marginVertical: theme.spacing[2],
  },
  apiText: {
    flex: 1,
    textAlign: 'right',
  },
  toggleRow: {
    borderWidth: 1,
    borderColor: theme.colors.border.soft,
    borderRadius: theme.radii.s,
    backgroundColor: theme.colors.surface.base,
    minHeight: 56,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing[1],
    gap: theme.spacing[2],
  },
  toggleRowEnabled: {
    borderColor: 'rgba(76, 175, 125, 0.42)',
    backgroundColor: 'rgba(76, 175, 125, 0.1)',
  },
  toggleCopy: {
    flex: 1,
  },
  toggleTrack: {
    width: 42,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#D9D9D9',
    padding: 2,
    justifyContent: 'center',
  },
  toggleTrackEnabled: {
    backgroundColor: 'rgba(76, 175, 125, 0.52)',
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
  },
  toggleThumbEnabled: {
    alignSelf: 'flex-end',
  },
});

import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Constants from 'expo-constants';

import {
  GlassSurface,
  GlassToggle,
  HeaderBar,
  ModeButton,
  ModeCard,
  ModeInput,
  ModeText,
  SafeScreen,
} from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import { getApiDebugInfo } from '../../../services/apiBaseUrl';
import {
  getMyTrainerSchedule,
  getTrainerSettingsMe,
  patchTrainerSettingsMe,
} from '../services/profileApi';
import {
  ASSISTANT_DISPLAY_NAME_MAX_LENGTH,
  prepareAssistantDisplayNameForSave,
  resolveAssistantDisplayName,
} from '../../messaging';
import { formatIsoWeekdaySummary } from '../../trainerClients/utils/scheduleResolver';

function valueOrFallback(value, fallback = 'Not available') {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  return fallback;
}

function formatExceptionDate(value) {
  if (!value) {
    return 'Unknown date';
  }
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function SettingToggle({ label, description, enabled, onToggle }) {
  return (
    <GlassSurface
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

export default function ProfileScreen({
  session,
  assignmentStatus,
  accessToken,
  onSignOut,
  onDeleteAccount,
  bottomInset = 0,
}) {
  const debugInfo = useMemo(() => getApiDebugInfo(), []);
  const email = valueOrFallback(session?.user?.email, 'No email found');
  const trainerName = valueOrFallback(assignmentStatus?.assigned_trainer_display_name, 'No trainer assigned');
  const appVersion = valueOrFallback(Constants.expoConfig?.version, 'dev');
  const environment = __DEV__ ? 'Development' : 'Production';
  const showDiagnostics = __DEV__;
  const isTrainerViewer = assignmentStatus?.viewer_role === 'trainer';

  const [tonePreference, setTonePreference] = useState(true);
  const [reminderPreference, setReminderPreference] = useState(true);
  const [trainerSettings, setTrainerSettings] = useState(null);
  const [trainerSettingsDraft, setTrainerSettingsDraft] = useState({
    defaultMeetingLocation: '',
    autoFillMeetingLocation: true,
    assistantDisplayName: '',
  });
  const [trainerSettingsError, setTrainerSettingsError] = useState(null);
  const [trainerSettingsSuccess, setTrainerSettingsSuccess] = useState(null);
  const [isLoadingTrainerSettings, setIsLoadingTrainerSettings] = useState(false);
  const [isSavingTrainerSettings, setIsSavingTrainerSettings] = useState(false);

  const [trainerSchedule, setTrainerSchedule] = useState(null);
  const [trainerScheduleError, setTrainerScheduleError] = useState(null);
  const [isLoadingTrainerSchedule, setIsLoadingTrainerSchedule] = useState(false);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState(null);
  const resolvedAssistantPreviewName = useMemo(
    () => resolveAssistantDisplayName(trainerSettingsDraft.assistantDisplayName),
    [trainerSettingsDraft.assistantDisplayName],
  );
  const assistantDisplayNameCharacterCount = String(
    trainerSettingsDraft.assistantDisplayName || '',
  ).trim().length;

  useEffect(() => {
    let isMounted = true;
    if (!accessToken || !isTrainerViewer) {
      setTrainerSettings(null);
      setTrainerSettingsError(null);
      setTrainerSettingsSuccess(null);
      return () => {
        isMounted = false;
      };
    }

    setIsLoadingTrainerSettings(true);
    setTrainerSettingsError(null);
    getTrainerSettingsMe({ accessToken })
      .then((payload) => {
        if (!isMounted) {
          return;
        }
        setTrainerSettings(payload);
        setTrainerSettingsDraft({
          defaultMeetingLocation: String(payload?.default_meeting_location || ''),
          autoFillMeetingLocation: payload?.auto_fill_meeting_location !== false,
          assistantDisplayName: String(payload?.assistant_display_name || ''),
        });
      })
      .catch((error) => {
        if (!isMounted) {
          return;
        }
        setTrainerSettingsError(error?.message || 'Unable to load trainer settings.');
      })
      .finally(() => {
        if (!isMounted) {
          return;
        }
        setIsLoadingTrainerSettings(false);
      });

    return () => {
      isMounted = false;
    };
  }, [accessToken, isTrainerViewer]);

  useEffect(() => {
    let isMounted = true;
    if (!accessToken || isTrainerViewer) {
      setTrainerSchedule(null);
      setTrainerScheduleError(null);
      return () => {
        isMounted = false;
      };
    }
    setIsLoadingTrainerSchedule(true);
    setTrainerScheduleError(null);
    getMyTrainerSchedule({ accessToken })
      .then((payload) => {
        if (!isMounted) {
          return;
        }
        setTrainerSchedule(payload);
      })
      .catch((error) => {
        if (!isMounted) {
          return;
        }
        setTrainerScheduleError(error?.message || 'Unable to load trainer schedule.');
      })
      .finally(() => {
        if (!isMounted) {
          return;
        }
        setIsLoadingTrainerSchedule(false);
      });

    return () => {
      isMounted = false;
    };
  }, [accessToken, isTrainerViewer]);

  const handleSaveTrainerSettings = async () => {
    if (!accessToken || isSavingTrainerSettings) {
      return;
    }
    setIsSavingTrainerSettings(true);
    setTrainerSettingsError(null);
    setTrainerSettingsSuccess(null);
    try {
      const trimmedLocation = String(trainerSettingsDraft.defaultMeetingLocation || '').trim();
      const normalizedAssistantName = prepareAssistantDisplayNameForSave(
        trainerSettingsDraft.assistantDisplayName,
      );
      const payload = await patchTrainerSettingsMe({
        accessToken,
        defaultMeetingLocation: trimmedLocation || null,
        autoFillMeetingLocation: Boolean(trainerSettingsDraft.autoFillMeetingLocation),
        assistantDisplayName: normalizedAssistantName,
      });
      setTrainerSettings(payload);
      setTrainerSettingsDraft({
        defaultMeetingLocation: String(payload?.default_meeting_location || ''),
        autoFillMeetingLocation: payload?.auto_fill_meeting_location !== false,
        assistantDisplayName: String(payload?.assistant_display_name || ''),
      });
      setTrainerSettingsSuccess('Trainer defaults saved.');
    } catch (error) {
      setTrainerSettingsError(error?.message || 'Unable to save trainer settings.');
    } finally {
      setIsSavingTrainerSettings(false);
    }
  };

  const handleDeleteAccountPress = async () => {
    if (!onDeleteAccount || isDeletingAccount) {
      return;
    }

    const normalized = String(deleteConfirmationText || '').trim().toUpperCase();
    if (normalized !== 'DELETE') {
      setDeleteAccountError('Type DELETE to confirm permanent account deletion.');
      return;
    }

    setIsDeletingAccount(true);
    setDeleteAccountError(null);
    try {
      await onDeleteAccount({ confirmation: 'DELETE' });
    } catch (error) {
      setDeleteAccountError(error?.message || 'Unable to delete account right now.');
    } finally {
      setIsDeletingAccount(false);
    }
  };

  return (
    <SafeScreen
      includeTopInset={false}
      style={styles.screen}
      atmosphere="system"
      atmosphereOverlayStrength={0.94}
    >
      <HeaderBar
        title="Settings"
        subtitle="Personalization and account details"
      />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: theme.spacing[4] + bottomInset },
        ]}
      >
        <ModeCard variant="hero">
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

        {isTrainerViewer ? (
          <ModeCard variant="surface">
            <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>Trainer Session Defaults</ModeText>
            <ModeText variant="bodySm" tone="secondary">
              Set your default session behavior and assistant identity for your workspace.
            </ModeText>

            <ModeInput
              value={trainerSettingsDraft.defaultMeetingLocation}
              onChangeText={(value) => setTrainerSettingsDraft((current) => ({
                ...current,
                defaultMeetingLocation: value,
              }))}
              placeholder="Default meeting location (e.g., My Gym)"
              style={styles.settingsInput}
            />

            <View style={styles.assistantNameSection}>
              <ModeText variant="bodySm">Name your assistant</ModeText>
              <ModeText variant="caption" tone="secondary">
                This is what your internal coaching AI will be called in your workspace.
              </ModeText>
              <ModeInput
                value={trainerSettingsDraft.assistantDisplayName}
                onChangeText={(value) => setTrainerSettingsDraft((current) => ({
                  ...current,
                  assistantDisplayName: value,
                }))}
                placeholder="Coach AI"
                maxLength={ASSISTANT_DISPLAY_NAME_MAX_LENGTH}
                style={styles.assistantNameInput}
              />
              <View style={styles.assistantPreviewCard}>
                <View style={styles.assistantPreviewRow}>
                  <ModeText variant="caption" tone="tertiary">Trainer</ModeText>
                  <ModeText variant="caption" tone="tertiary">{resolvedAssistantPreviewName}</ModeText>
                </View>
                <ModeText variant="caption" tone="secondary">
                  Preview: Trainer and {resolvedAssistantPreviewName}
                </ModeText>
              </View>
              <ModeText variant="caption" tone="tertiary">
                {`${assistantDisplayNameCharacterCount}/${ASSISTANT_DISPLAY_NAME_MAX_LENGTH} characters`}
              </ModeText>
            </View>

            <SettingToggle
              label="Auto-fill for client sessions"
              description="When enabled, your default location is used when a client has no override."
              enabled={Boolean(trainerSettingsDraft.autoFillMeetingLocation)}
              onToggle={() => setTrainerSettingsDraft((current) => ({
                ...current,
                autoFillMeetingLocation: !current.autoFillMeetingLocation,
              }))}
            />

            <ModeButton
              title={isSavingTrainerSettings ? 'Saving...' : 'Save Trainer Defaults'}
              variant="secondary"
              disabled={isSavingTrainerSettings || isLoadingTrainerSettings}
              onPress={handleSaveTrainerSettings}
              style={styles.settingsAction}
            />

            {isLoadingTrainerSettings ? (
              <ModeText variant="caption" tone="secondary">Loading trainer defaults...</ModeText>
            ) : null}
            {trainerSettings ? (
              <View style={styles.trainerDefaultsSummary}>
                <ModeText variant="caption" tone="secondary">
                  Current default location: {valueOrFallback(trainerSettings.default_meeting_location, 'Not set')}
                </ModeText>
                <ModeText variant="caption" tone="secondary">
                  Assistant name: {resolveAssistantDisplayName(trainerSettings.assistant_display_name)}
                </ModeText>
              </View>
            ) : null}
            {trainerSettingsError ? (
              <ModeText variant="caption" tone="error">{trainerSettingsError}</ModeText>
            ) : null}
            {trainerSettingsSuccess ? (
              <ModeText variant="caption" tone="secondary">{trainerSettingsSuccess}</ModeText>
            ) : null}
          </ModeCard>
        ) : (
          <ModeCard variant="surface">
            <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>Trainer Schedule</ModeText>
            {isLoadingTrainerSchedule ? (
              <ModeText variant="bodySm" tone="secondary">Loading trainer schedule...</ModeText>
            ) : null}
            {!isLoadingTrainerSchedule && trainerScheduleError ? (
              <ModeText variant="bodySm" tone="error">{trainerScheduleError}</ModeText>
            ) : null}
            {!isLoadingTrainerSchedule && !trainerScheduleError ? (
              <>
                <ModeText variant="bodySm" tone="secondary">
                  Trainer: {valueOrFallback(trainerSchedule?.trainer_display_name, 'Not assigned')}
                </ModeText>
                <ModeText variant="bodySm">
                  Weekly Days: {formatIsoWeekdaySummary(trainerSchedule?.recurring_weekdays)}
                </ModeText>
                <ModeText variant="bodySm" tone="secondary">
                  Typical Location: {valueOrFallback(trainerSchedule?.resolved_default_meeting_location, 'Not set')}
                </ModeText>
                {Array.isArray(trainerSchedule?.upcoming_exceptions) && trainerSchedule.upcoming_exceptions.length > 0 ? (
                  <View style={styles.trainerScheduleList}>
                    {trainerSchedule.upcoming_exceptions.map((exception) => (
                      <ModeText
                        key={`${exception.client_id || trainerSchedule?.client_id}-${exception.session_date}`}
                        variant="caption"
                        tone="secondary"
                      >
                        • {formatExceptionDate(exception.session_date)}: {exception.exception_type}
                        {exception.meeting_location_override ? ` @ ${exception.meeting_location_override}` : ''}
                      </ModeText>
                    ))}
                  </View>
                ) : (
                  <ModeText variant="caption" tone="secondary">No upcoming exceptions.</ModeText>
                )}
                <ModeText variant="caption" tone="tertiary">
                  This section is view-only. Schedule edits are trainer-managed.
                </ModeText>
              </>
            ) : null}
          </ModeCard>
        )}

        {showDiagnostics ? (
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
        ) : null}

        <ModeCard variant="surface">
          <ModeText variant="label" tone="tertiary" style={styles.sectionLabel}>Account Deletion</ModeText>
          <ModeText variant="bodySm" tone="secondary">
            Permanently deletes your account, sessions, chat history, files, and linked training data.
          </ModeText>
          <ModeInput
            value={deleteConfirmationText}
            onChangeText={setDeleteConfirmationText}
            placeholder="Type DELETE to confirm"
            autoCapitalize="characters"
            style={styles.settingsInput}
          />
          {deleteAccountError ? (
            <ModeText variant="caption" tone="error">{deleteAccountError}</ModeText>
          ) : null}
          <ModeButton
            title={isDeletingAccount ? 'Deleting Account...' : 'Delete Account Permanently'}
            variant="destructive"
            disabled={isDeletingAccount}
            onPress={handleDeleteAccountPress}
          />
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
    backgroundColor: theme.colors.background.app,
  },
  content: {
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[3],
    gap: theme.spacing[2],
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
  settingsInput: {
    marginTop: theme.spacing[2],
    marginBottom: theme.spacing[1],
  },
  settingsAction: {
    marginTop: theme.spacing[1],
    marginBottom: theme.spacing[1],
  },
  assistantNameSection: {
    marginBottom: theme.spacing[1],
    gap: theme.spacing[1],
  },
  assistantNameInput: {
    marginTop: 0,
    marginBottom: 0,
  },
  assistantPreviewCard: {
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.border.soft,
    backgroundColor: theme.colors.surface.base,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    gap: theme.spacing[1] - 4,
  },
  assistantPreviewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  trainerDefaultsSummary: {
    gap: theme.spacing[1] - 4,
  },
  trainerScheduleList: {
    marginTop: theme.spacing[1],
    marginBottom: theme.spacing[1],
    gap: theme.spacing[1] - 4,
  },
});

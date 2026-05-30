import React from 'react';
import { StyleSheet, View } from 'react-native';

import {
  ModeButton,
  ModeCard,
  ModeInput,
  ModeText,
} from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import { ASSISTANT_DISPLAY_NAME_MAX_LENGTH } from '../../messaging';
import {
  SettingToggle,
  SettingsScreenShell,
  SettingsSectionLabel,
} from './SettingsScreenShell';

export default function TrainerDefaultsScreen({
  trainerSettingsDraft,
  onTrainerSettingsDraftChange,
  resolvedAssistantPreviewName,
  assistantDisplayNameCharacterCount,
  isLoadingTrainerSettings,
  isSavingTrainerSettings,
  trainerSettingsError,
  trainerSettingsSuccess,
  onSaveTrainerSettings,
  bottomInset,
  onBack,
}) {
  return (
    <SettingsScreenShell
      title="Trainer Defaults"
      subtitle="Session behavior and assistant identity"
      bottomInset={bottomInset}
      onBack={onBack}
    >
      <ModeCard variant="surface">
        <SettingsSectionLabel>Trainer Session Defaults</SettingsSectionLabel>
        <ModeText variant="bodySm" tone="secondary">
          Set your default session behavior and assistant identity for your workspace.
        </ModeText>

        <ModeInput
          value={trainerSettingsDraft.defaultMeetingLocation}
          onChangeText={(value) => onTrainerSettingsDraftChange((current) => ({
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
            onChangeText={(value) => onTrainerSettingsDraftChange((current) => ({
              ...current,
              assistantDisplayName: value,
            }))}
            placeholder="Coach AI"
            maxLength={ASSISTANT_DISPLAY_NAME_MAX_LENGTH}
            style={styles.assistantNameInput}
          />
          <ModeText variant="caption" tone="tertiary">
            Preview: Trainer and {resolvedAssistantPreviewName}
          </ModeText>
          <ModeText variant="caption" tone="tertiary">
            {`${assistantDisplayNameCharacterCount}/${ASSISTANT_DISPLAY_NAME_MAX_LENGTH} characters`}
          </ModeText>
        </View>

        <SettingToggle
          label="Auto-fill for client sessions"
          description="When enabled, your default location is used when a client has no override."
          enabled={Boolean(trainerSettingsDraft.autoFillMeetingLocation)}
          onToggle={() => onTrainerSettingsDraftChange((current) => ({
            ...current,
            autoFillMeetingLocation: !current.autoFillMeetingLocation,
          }))}
        />

        <ModeButton
          title={isSavingTrainerSettings ? 'Saving...' : 'Save Trainer Defaults'}
          variant="secondary"
          disabled={isSavingTrainerSettings || isLoadingTrainerSettings}
          onPress={onSaveTrainerSettings}
          style={styles.settingsAction}
        />

        {isLoadingTrainerSettings ? (
          <ModeText variant="caption" tone="secondary">Loading trainer defaults...</ModeText>
        ) : null}
        {trainerSettingsError ? (
          <ModeText variant="caption" tone="error">{trainerSettingsError}</ModeText>
        ) : null}
        {trainerSettingsSuccess ? (
          <ModeText variant="caption" tone="success">{trainerSettingsSuccess}</ModeText>
        ) : null}
      </ModeCard>
    </SettingsScreenShell>
  );
}

const styles = StyleSheet.create({
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
});

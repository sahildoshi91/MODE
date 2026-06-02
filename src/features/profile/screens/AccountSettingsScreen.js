import React from 'react';
import { StyleSheet } from 'react-native';

import {
  ModeButton,
  ModeCard,
  ModeInput,
  ModeText,
  SystemSectionCard,
  SystemSectionHeader,
} from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import {
  SettingsDetailRow,
  SettingsDivider,
  SettingsScreenShell,
  SettingsSectionLabel,
} from './SettingsScreenShell';

export default function AccountSettingsScreen({
  email,
  trainerName,
  deleteConfirmationText,
  onDeleteConfirmationTextChange,
  deleteAccountError,
  deleteAccountNotice,
  isDeletingAccount,
  onDeleteAccountPress,
  bottomInset,
  onBack,
}) {
  return (
    <SettingsScreenShell
      title="Account"
      subtitle="Email and coach details"
      bottomInset={bottomInset}
      onBack={onBack}
    >
      <ModeCard variant="surface">
        <SettingsSectionLabel>Account</SettingsSectionLabel>
        <SettingsDetailRow label="Email" value={email} />
        <SettingsDivider />
        <SettingsDetailRow label="Coach" value={trainerName} />
      </ModeCard>

      <SystemSectionCard style={styles.dangerCard}>
        <SystemSectionHeader title="Danger Zone" />
        <ModeText variant="bodySm" tone="secondary" style={styles.dangerDescription}>
          Submits a permanent deletion request for your account, sessions, chat history, files, and linked training data. Processing may continue after sign-out.
        </ModeText>
        <ModeInput
          value={deleteConfirmationText}
          onChangeText={onDeleteConfirmationTextChange}
          placeholder="Type DELETE to confirm"
          autoCapitalize="characters"
          style={styles.deleteInput}
        />
        {deleteAccountError ? (
          <ModeText variant="caption" tone="error">{deleteAccountError}</ModeText>
        ) : null}
        {deleteAccountNotice ? (
          <ModeText variant="caption" tone="secondary">{deleteAccountNotice}</ModeText>
        ) : null}
        <ModeButton
          title={isDeletingAccount ? 'Submitting Request...' : 'Submit Deletion Request'}
          variant="destructive"
          disabled={isDeletingAccount}
          onPress={onDeleteAccountPress}
          style={styles.deleteButton}
        />
      </SystemSectionCard>
    </SettingsScreenShell>
  );
}

const styles = StyleSheet.create({
  dangerCard: {
    borderColor: theme.colors.feedback.errorBorder,
    backgroundColor: theme.colors.feedback.errorBg,
  },
  dangerDescription: {
    marginBottom: theme.spacing[1],
  },
  deleteInput: {
    marginTop: theme.spacing[1],
    marginBottom: theme.spacing[1],
  },
  deleteButton: {
    marginTop: theme.spacing[1],
  },
});

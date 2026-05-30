import React from 'react';
import { StyleSheet } from 'react-native';

import {
  ModeButton,
  ModeCard,
  ModeInput,
  ModeText,
} from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import {
  SettingsScreenShell,
  SettingsSectionLabel,
} from './SettingsScreenShell';

export default function DeleteAccountScreen({
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
      title="Delete Account"
      subtitle="Permanent deletion request"
      bottomInset={bottomInset}
      onBack={onBack}
    >
      <ModeCard variant="surface">
        <SettingsSectionLabel>Account Deletion</SettingsSectionLabel>
        <ModeText variant="bodySm" tone="secondary">
          Submits a permanent deletion request for your account, sessions, chat history, files, and linked training data. Processing may continue after sign-out.
        </ModeText>
        <ModeInput
          value={deleteConfirmationText}
          onChangeText={onDeleteConfirmationTextChange}
          placeholder="Type DELETE to confirm"
          autoCapitalize="characters"
          style={styles.settingsInput}
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
        />
      </ModeCard>
    </SettingsScreenShell>
  );
}

const styles = StyleSheet.create({
  settingsInput: {
    marginTop: theme.spacing[2],
    marginBottom: theme.spacing[1],
  },
});

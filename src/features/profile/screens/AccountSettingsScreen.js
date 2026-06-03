import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  ModeButton,
  ModeCard,
  ModeInput,
  ModeText,
  SystemSectionCard,
} from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import {
  SettingsDivider,
  SettingsNavDivider,
  SettingsNavRow,
  SettingsScreenShell,
  SettingsSectionLabel,
} from './SettingsScreenShell';

export default function AccountSettingsScreen(props) {
  const { onBack } = props;
  const [subView, setSubView] = useState(null);

  const nav = (key) => () => setSubView(key);
  const goHub = () => setSubView(null);

  if (subView === 'email')        return <ChangeEmailSubView    {...props} onBack={goHub} />;
  if (subView === 'password')     return <ChangePasswordSubView {...props} onBack={goHub} />;
  if (subView === 'coach')        return <CoachProfileSubView   {...props} onBack={goHub} />;
  if (subView === 'availability') return <AvailabilitySubView   {...props} onBack={goHub} />;
  if (subView === 'delete')       return <DeleteAccountSubView  {...props} onBack={goHub} />;

  return <AccountHub {...props} onBack={onBack} onNavigate={nav} />;
}

function AccountHub({
  email,
  pendingEmailChange,
  hasAssignedCoach,
  trainerName,
  bottomInset,
  onBack,
  onNavigate,
}) {
  return (
    <SettingsScreenShell
      title="Account"
      subtitle="Email and coach details"
      bottomInset={bottomInset}
      onBack={onBack}
    >
      <View>
        <SettingsSectionLabel>Account</SettingsSectionLabel>
        <SystemSectionCard style={styles.sectionCard}>
          <SettingsNavRow
            title="Email Address"
            subtitle={email}
            badge={pendingEmailChange ? null : 'Confirmed'}
            badgeVariant="success"
            onPress={onNavigate('email')}
            testID="account-nav-email"
          />
          <SettingsNavDivider />
          <SettingsNavRow
            title="Password"
            subtitle="Update your password"
            onPress={onNavigate('password')}
            testID="account-nav-password"
          />
        </SystemSectionCard>
      </View>

      <View>
        <SettingsSectionLabel>Coach</SettingsSectionLabel>
        <SystemSectionCard style={styles.sectionCard}>
          <SettingsNavRow
            title="Coach Profile"
            subtitle={hasAssignedCoach ? trainerName : 'Name, bio, and photo'}
            onPress={onNavigate('coach')}
            testID="account-nav-coach"
          />
          <SettingsNavDivider />
          <SettingsNavRow
            title="Availability"
            subtitle="Set your schedule"
            badge={hasAssignedCoach ? null : 'Incomplete'}
            badgeVariant="warning"
            onPress={onNavigate('availability')}
            testID="account-nav-availability"
          />
        </SystemSectionCard>
      </View>

      <View>
        <SettingsSectionLabel>Danger Zone</SettingsSectionLabel>
        <SystemSectionCard style={[styles.sectionCard, styles.dangerCard]}>
          <SettingsNavRow
            title="Delete Account"
            subtitle="Permanently remove your data"
            titleStyle={styles.dangerTitle}
            onPress={onNavigate('delete')}
            testID="account-nav-delete"
          />
        </SystemSectionCard>
      </View>
    </SettingsScreenShell>
  );
}

function ChangeEmailSubView({
  email,
  pendingEmailChange,
  pendingEmail,
  isLoadingAccount,
  accountEmailDraft,
  onAccountEmailDraftChange,
  onUpdateAccountEmailPress,
  isUpdatingAccountEmail,
  accountError,
  accountNotice,
  bottomInset,
  onBack,
}) {
  return (
    <SettingsScreenShell
      title="Email Address"
      bottomInset={bottomInset}
      onBack={onBack}
    >
      <ModeCard variant="surface">
        <ModeText variant="bodySm" tone="secondary">Current email</ModeText>
        <ModeText variant="bodySm" style={styles.currentValue}>{email}</ModeText>
        {pendingEmailChange && pendingEmail ? (
          <>
            <SettingsDivider />
            <ModeText variant="bodySm" tone="secondary" testID="account-pending-email-copy">
              Confirmation sent to {pendingEmail}.
            </ModeText>
          </>
        ) : null}
        <SettingsDivider />
        <ModeInput
          value={accountEmailDraft}
          onChangeText={onAccountEmailDraftChange}
          placeholder="email@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          style={styles.input}
          testID="account-email-input"
        />
        <ModeButton
          title={isUpdatingAccountEmail ? 'Sending Confirmation...' : 'Change Email'}
          variant="secondary"
          disabled={isUpdatingAccountEmail || isLoadingAccount}
          onPress={onUpdateAccountEmailPress}
          style={styles.actionButton}
          testID="account-change-email-button"
        />
        {accountError ? (
          <ModeText variant="caption" tone="error">{accountError}</ModeText>
        ) : null}
        {accountNotice ? (
          <ModeText variant="caption" tone="secondary">{accountNotice}</ModeText>
        ) : null}
      </ModeCard>
    </SettingsScreenShell>
  );
}

function ChangePasswordSubView({
  isLoadingAccount,
  accountPasswordDraft,
  onAccountPasswordDraftChange,
  accountPasswordConfirmationDraft,
  onAccountPasswordConfirmationDraftChange,
  onUpdateAccountPasswordPress,
  isUpdatingAccountPassword,
  accountError,
  accountNotice,
  bottomInset,
  onBack,
}) {
  return (
    <SettingsScreenShell
      title="Password"
      bottomInset={bottomInset}
      onBack={onBack}
    >
      <ModeCard variant="surface">
        <ModeInput
          value={accountPasswordDraft}
          onChangeText={onAccountPasswordDraftChange}
          placeholder="New password"
          secureTextEntry
          style={styles.input}
          testID="account-password-input"
        />
        <ModeInput
          value={accountPasswordConfirmationDraft}
          onChangeText={onAccountPasswordConfirmationDraftChange}
          placeholder="Confirm new password"
          secureTextEntry
          style={styles.input}
          testID="account-password-confirmation-input"
        />
        <ModeButton
          title={isUpdatingAccountPassword ? 'Updating Password...' : 'Update Password'}
          variant="secondary"
          disabled={isUpdatingAccountPassword || isLoadingAccount}
          onPress={onUpdateAccountPasswordPress}
          style={styles.actionButton}
          testID="account-update-password-button"
        />
        {accountError ? (
          <ModeText variant="caption" tone="error">{accountError}</ModeText>
        ) : null}
        {accountNotice ? (
          <ModeText variant="caption" tone="secondary">{accountNotice}</ModeText>
        ) : null}
      </ModeCard>
    </SettingsScreenShell>
  );
}

function CoachProfileSubView({
  hasAssignedCoach,
  trainerName,
  isSelfGuided,
  isLoadingAccount,
  accountInviteCodeDraft,
  onAccountInviteCodeDraftChange,
  onChangeCoachByInvitePress,
  isChangingCoach,
  onRequestRemoveCoachPress,
  onCancelRemoveCoachPress,
  onConfirmRemoveCoachPress,
  isConfirmingCoachRemoval,
  isRemovingCoach,
  accountError,
  accountNotice,
  bottomInset,
  onBack,
}) {
  return (
    <SettingsScreenShell
      title="Coach Profile"
      bottomInset={bottomInset}
      onBack={onBack}
    >
      <ModeCard variant="surface">
        <ModeText variant="bodySm" tone="secondary">
          {hasAssignedCoach ? 'Current coach' : 'Status'}
        </ModeText>
        <ModeText variant="bodySm" style={styles.currentValue}>
          {hasAssignedCoach ? trainerName : 'No coach assigned'}
        </ModeText>
        {isSelfGuided && !hasAssignedCoach ? (
          <>
            <SettingsDivider />
            <ModeText variant="caption" tone="secondary">Self-guided</ModeText>
          </>
        ) : null}
        <SettingsDivider />
        <ModeInput
          value={accountInviteCodeDraft}
          onChangeText={onAccountInviteCodeDraftChange}
          placeholder="Invite code"
          autoCapitalize="characters"
          style={styles.input}
          testID="account-coach-invite-input"
        />
        <ModeButton
          title={isChangingCoach ? 'Updating Coach...' : (hasAssignedCoach ? 'Change Coach' : 'Assign Coach')}
          variant="primary"
          disabled={isChangingCoach || isLoadingAccount}
          onPress={onChangeCoachByInvitePress}
          style={styles.actionButton}
          testID="account-change-coach-button"
        />
        {hasAssignedCoach ? (
          isConfirmingCoachRemoval ? (
            <View style={styles.confirmRemoveBlock}>
              <ModeText variant="bodySm" tone="secondary">
                Remove coach access and continue without a coach?
              </ModeText>
              <ModeButton
                title={isRemovingCoach ? 'Removing Coach...' : 'Confirm Remove Coach'}
                variant="destructive"
                disabled={isRemovingCoach || isLoadingAccount}
                onPress={onConfirmRemoveCoachPress}
                style={styles.actionButton}
                testID="account-confirm-remove-coach-button"
              />
              <ModeButton
                title="Cancel"
                variant="ghost"
                disabled={isRemovingCoach}
                onPress={onCancelRemoveCoachPress}
                style={styles.actionButton}
                testID="account-cancel-remove-coach-button"
              />
            </View>
          ) : (
            <ModeButton
              title="Remove Coach"
              variant="destructive"
              disabled={isRemovingCoach || isLoadingAccount}
              onPress={onRequestRemoveCoachPress}
              style={styles.actionButton}
              testID="account-remove-coach-button"
            />
          )
        ) : null}
        {accountError ? (
          <ModeText variant="caption" tone="error">{accountError}</ModeText>
        ) : null}
        {accountNotice ? (
          <ModeText variant="caption" tone="secondary">{accountNotice}</ModeText>
        ) : null}
      </ModeCard>
    </SettingsScreenShell>
  );
}

function AvailabilitySubView({ bottomInset, onBack }) {
  return (
    <SettingsScreenShell
      title="Availability"
      subtitle="Set your schedule"
      bottomInset={bottomInset}
      onBack={onBack}
    >
      <ModeCard variant="surface">
        <ModeText variant="bodySm" tone="secondary">
          Availability scheduling coming soon.
        </ModeText>
      </ModeCard>
    </SettingsScreenShell>
  );
}

function DeleteAccountSubView({
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
      bottomInset={bottomInset}
      onBack={onBack}
    >
      <ModeCard variant="surface" style={styles.deleteCard}>
        <ModeText variant="bodySm" tone="secondary" style={styles.deleteDescription}>
          Submits a permanent deletion request for your account, sessions, chat history, files, and linked training data. Processing may continue after sign-out.
        </ModeText>
        <ModeInput
          value={deleteConfirmationText}
          onChangeText={onDeleteConfirmationTextChange}
          placeholder="Type DELETE to confirm"
          autoCapitalize="characters"
          style={styles.input}
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
          style={styles.actionButton}
        />
      </ModeCard>
    </SettingsScreenShell>
  );
}

const styles = StyleSheet.create({
  sectionCard: {
    paddingHorizontal: 0,
    paddingVertical: 0,
    gap: 0,
  },
  dangerCard: {
    borderColor: theme.colors.feedback.errorBorder,
    backgroundColor: theme.colors.feedback.errorBg,
  },
  dangerTitle: {
    color: theme.colors.status.error,
  },
  currentValue: {
    marginTop: 2,
  },
  input: {
    marginTop: theme.spacing[1],
  },
  actionButton: {
    marginTop: theme.spacing[1],
  },
  confirmRemoveBlock: {
    marginTop: theme.spacing[2],
    gap: theme.spacing[1],
  },
  deleteCard: {
    borderColor: theme.colors.feedback.errorBorder,
    backgroundColor: theme.colors.feedback.errorBg,
  },
  deleteDescription: {
    marginBottom: theme.spacing[1],
  },
});

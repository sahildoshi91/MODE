import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { InlineFeedback, ModeButton, ModeCard, ModeInput, ModeText, SafeScreen } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import { assignTrainerByInvite } from '../../trainerAssignment/services/trainerAssignmentApi';

export default function CoachTabGuardScreen({ accessToken, bottomInset = 0, onAttached, onBackHome }) {
  const [inviteCode, setInviteCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [infoMessage, setInfoMessage] = useState(null);

  const handleAttach = async () => {
    const normalized = inviteCode.trim();
    if (!normalized) {
      setErrorMessage('Enter an invite code to attach your trainer.');
      return;
    }
    setIsSubmitting(true);
    setErrorMessage(null);
    setInfoMessage(null);
    try {
      await assignTrainerByInvite({ accessToken, inviteCode: normalized });
      setInfoMessage('Trainer attached. You can now use Coach chat.');
      onAttached?.();
    } catch (error) {
      setErrorMessage(error?.message || 'Unable to attach trainer with invite code.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeScreen style={styles.screen} includeBottomInset={false}>
      <View style={[styles.content, { paddingBottom: bottomInset + theme.spacing[3] }]}>
        <ModeCard variant="tinted" style={styles.card}>
          <ModeText variant="h2">Coach chat needs a trainer</ModeText>
          <ModeText variant="bodySm" tone="secondary" style={styles.body}>
            You can keep using check-ins and progress while unassigned. Attach a trainer anytime with an invite code.
          </ModeText>

          <ModeInput
            placeholder="Invite code"
            value={inviteCode}
            onChangeText={setInviteCode}
            editable={!isSubmitting}
          />
          <ModeButton
            title={isSubmitting ? 'Please wait...' : 'Attach Trainer'}
            onPress={handleAttach}
            disabled={isSubmitting}
            style={styles.primary}
          />
          <ModeButton
            variant="secondary"
            title="Continue without Coach"
            onPress={onBackHome}
            disabled={isSubmitting}
            style={styles.secondary}
          />

          {infoMessage ? <InlineFeedback type="success" message={infoMessage} /> : null}
          {errorMessage ? <InlineFeedback type="error" message={errorMessage} /> : null}
        </ModeCard>
      </View>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: theme.colors.background.app,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing[3],
  },
  card: {
    marginBottom: 0,
  },
  body: {
    marginTop: theme.spacing[1],
    marginBottom: theme.spacing[2],
  },
  primary: {
    marginTop: theme.spacing[1],
  },
  secondary: {
    marginTop: theme.spacing[2],
  },
});

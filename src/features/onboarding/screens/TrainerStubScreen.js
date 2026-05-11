import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { InlineFeedback, ModeButton, ModeCard, ModeInput, ModeText, SafeScreen } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import { completeOnboarding } from '../services/onboardingApi';

export default function TrainerStubScreen({ accessToken, bootstrap, onBootstrapUpdate, onSignOut }) {
  const payload = bootstrap?.onboarding_payload || {};
  const [trainerName, setTrainerName] = useState(payload?.trainer_name || '');
  const [contactEmail, setContactEmail] = useState(payload?.contact_email || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [infoMessage, setInfoMessage] = useState(null);

  const handleContinue = async () => {
    setIsSubmitting(true);
    setErrorMessage(null);
    setInfoMessage(null);
    try {
      const updated = await completeOnboarding({
        accessToken,
        currentStep: 'trainer_stub',
        payload: {
          ...(payload && typeof payload === 'object' ? payload : {}),
          trainer_name: trainerName,
          contact_email: contactEmail,
        },
      });
      onBootstrapUpdate(updated);
      setInfoMessage("Thanks. We'll notify you when trainer tools are live.");
    } catch (error) {
      setErrorMessage(error?.message || 'Unable to save your trainer details right now.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeScreen style={styles.screen}>
      <View style={styles.content}>
        <ModeText variant="h2">Trainer tools are coming soon</ModeText>
        <ModeText variant="bodySm" tone="secondary" style={styles.subtitle}>
          We&apos;re shipping client onboarding first. Share your details and we&apos;ll keep you updated.
        </ModeText>

        <ModeCard variant="tinted" style={styles.card}>
          <ModeInput
            placeholder="Trainer name (optional)"
            value={trainerName}
            onChangeText={setTrainerName}
            editable={!isSubmitting}
          />
          <ModeInput
            placeholder="Email (optional)"
            value={contactEmail}
            onChangeText={setContactEmail}
            keyboardType="email-address"
            editable={!isSubmitting}
          />
        </ModeCard>

        {infoMessage ? <InlineFeedback type="success" message={infoMessage} /> : null}
        {errorMessage ? <InlineFeedback type="error" message={errorMessage} /> : null}
      </View>

      <View style={styles.footer}>
        <ModeButton
          title={isSubmitting ? 'Please wait...' : 'Continue'}
          onPress={handleContinue}
          disabled={isSubmitting}
        />
        <ModeButton
          variant="secondary"
          title="Sign out"
          onPress={onSignOut}
          disabled={isSubmitting}
          style={styles.secondary}
        />
      </View>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: theme.colors.surface.canvas,
  },
  content: {
    flex: 1,
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[5],
  },
  subtitle: {
    marginTop: theme.spacing[1],
    marginBottom: theme.spacing[3],
  },
  card: {
    marginBottom: theme.spacing[2],
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border.soft,
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[3],
    backgroundColor: theme.colors.surface.canvas,
  },
  secondary: {
    marginTop: theme.spacing[2],
  },
});

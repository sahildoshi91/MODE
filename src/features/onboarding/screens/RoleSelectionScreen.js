import React from 'react';
import { StyleSheet, View } from 'react-native';

import { InlineFeedback, ModeButton, ModeCard, ModeText, SafeScreen } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';

export default function RoleSelectionScreen({ onSelectClient, onSelectTrainer, isSubmitting, errorMessage }) {
  return (
    <SafeScreen style={styles.screen}>
      <View style={styles.content}>
        <ModeText variant="h2">How will you use MODE?</ModeText>
        <ModeText variant="bodySm" tone="secondary" style={styles.subtitle}>
          Choose your path. You can update this later.
        </ModeText>

        <ModeCard variant="tinted" style={styles.card}>
          <ModeText variant="h3">I&apos;m a Client</ModeText>
          <ModeText variant="bodySm" tone="secondary" style={styles.cardBody}>
            Daily decisions, quick check-ins, and a simple plan that adapts.
          </ModeText>
          <ModeButton
            testID="role-selection-client-button"
            title={isSubmitting ? 'Please wait...' : 'Continue as Client'}
            onPress={onSelectClient}
            disabled={isSubmitting}
            style={styles.cardButton}
          />
        </ModeCard>

        <ModeCard variant="tinted" style={styles.card}>
          <ModeText variant="h3">I&apos;m a Trainer</ModeText>
          <ModeText variant="bodySm" tone="secondary" style={styles.cardBody}>
            Trainer tooling is in progress. You can join the early waitlist flow.
          </ModeText>
          <ModeButton
            testID="role-selection-trainer-button"
            variant="secondary"
            title={isSubmitting ? 'Please wait...' : 'Continue as Trainer'}
            onPress={onSelectTrainer}
            disabled={isSubmitting}
            style={styles.cardButton}
          />
        </ModeCard>

        {errorMessage ? (
          <InlineFeedback
            testID="role-selection-error"
            type="error"
            message={errorMessage}
          />
        ) : null}
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
  cardBody: {
    marginTop: theme.spacing[1],
  },
  cardButton: {
    marginTop: theme.spacing[2],
  },
});

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { HeaderBar, ModeButton, ModeCard, SafeScreen } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';

export default function TrainerAssignmentScreen({
  trainers,
  isSubmitting,
  errorMessage,
  onAssignTrainer,
  onSignOut,
}) {
  const showEmptyState = trainers.length === 0 && !errorMessage;

  return (
    <SafeScreen style={styles.screen}>
      <HeaderBar title="Pick Your Trainer" subtitle="Choose who should coach this account" />

      <ScrollView contentContainerStyle={styles.content}>
        <ModeCard>
          <Text style={styles.title}>No active trainer is assigned yet</Text>
          <Text style={styles.body}>
            Pick a trainer below and we'll connect this login to that coaching context before chat starts.
          </Text>
          {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
        </ModeCard>

        {trainers.map((trainer) => (
          <ModeCard key={trainer.id} style={styles.trainerCard}>
            <Text style={styles.trainerName}>{trainer.display_name}</Text>
            <ModeButton
              title={isSubmitting ? 'Assigning...' : `Choose ${trainer.display_name}`}
              onPress={() => onAssignTrainer(trainer.id)}
              disabled={isSubmitting}
            />
          </ModeCard>
        ))}

        {showEmptyState ? (
          <ModeCard>
            <Text style={styles.body}>
              No active trainers are available right now. Sign out and try another account, or add an active trainer in the admin setup first.
            </Text>
          </ModeCard>
        ) : null}

        <ModeButton
          title="Sign Out"
          variant="secondary"
          onPress={onSignOut}
          disabled={isSubmitting}
          style={styles.signOutButton}
        />
      </ScrollView>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  screen: {
  },
  content: {
    padding: theme.spacing[3],
    paddingBottom: theme.spacing[5],
  },
  title: {
    color: theme.colors.textHigh,
    ...theme.typography.h3,
    marginBottom: theme.spacing[1],
  },
  body: {
    color: theme.colors.textMedium,
    ...theme.typography.body1,
  },
  error: {
    color: theme.colors.error,
    ...theme.typography.body2,
    marginTop: theme.spacing[2],
  },
  trainerCard: {
    gap: theme.spacing[2],
  },
  trainerName: {
    color: theme.colors.textHigh,
    ...theme.typography.h3,
  },
  signOutButton: {
    marginTop: theme.spacing[2],
  },
});

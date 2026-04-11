import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { HeaderBar, ModeButton, ModeCard, SafeScreen } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';

export default function TrainerAssignmentScreen({
  trainers,
  availableTrainerCount,
  hasLoadedStatus,
  isStatusLoading,
  statusLoadFailed,
  isSubmitting,
  errorMessage,
  errorRequestId,
  errorApiBase,
  onRetryStatusLoad,
  onAssignTrainer,
  bottomInset = 0,
}) {
  const resolvedTrainerCount = Number.isInteger(availableTrainerCount)
    ? availableTrainerCount
    : trainers.length;
  const showEmptyState = hasLoadedStatus && resolvedTrainerCount === 0 && !statusLoadFailed;

  return (
    <SafeScreen style={styles.screen}>
      <HeaderBar title="Pick Your Trainer" subtitle="Choose who should coach this account" />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: theme.spacing[5] + bottomInset },
        ]}
      >
        <ModeCard>
          <Text style={styles.title}>No active trainer is assigned yet</Text>
          <Text style={styles.body}>
            Pick a trainer below and we'll connect this login to that coaching context before chat starts.
          </Text>
          {!statusLoadFailed && errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
        </ModeCard>

        {statusLoadFailed ? (
          <ModeCard style={styles.blockingCard}>
            <Text style={styles.blockingTitle}>Unable to load trainer options</Text>
            {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
            {errorRequestId ? <Text style={styles.meta}>Request ID: {errorRequestId}</Text> : null}
            {errorApiBase ? <Text style={styles.meta}>API Base: {errorApiBase}</Text> : null}
            <ModeButton
              title={isStatusLoading ? 'Retrying...' : 'Retry'}
              onPress={onRetryStatusLoad}
              disabled={isStatusLoading}
            />
          </ModeCard>
        ) : null}

        {!statusLoadFailed ? trainers.map((trainer) => (
          <ModeCard key={trainer.id} style={styles.trainerCard}>
            <Text style={styles.trainerName}>{trainer.display_name}</Text>
            <ModeButton
              title={isSubmitting ? 'Assigning...' : `Choose ${trainer.display_name}`}
              onPress={() => onAssignTrainer(trainer.id)}
              disabled={isSubmitting || isStatusLoading}
            />
          </ModeCard>
        )) : null}

        {showEmptyState ? (
          <ModeCard>
            <Text style={styles.body}>
              No active trainers are available right now. Try another account from the Profile tab, or add an active trainer in the admin setup first.
            </Text>
          </ModeCard>
        ) : null}
      </ScrollView>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  screen: {
  },
  content: {
    padding: theme.spacing[3],
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
  blockingCard: {
    gap: theme.spacing[2],
  },
  blockingTitle: {
    color: theme.colors.textHigh,
    ...theme.typography.h3,
  },
  meta: {
    color: theme.colors.textMedium,
    ...theme.typography.body2,
  },
  trainerCard: {
    gap: theme.spacing[2],
  },
  trainerName: {
    color: theme.colors.textHigh,
    ...theme.typography.h3,
  },
});

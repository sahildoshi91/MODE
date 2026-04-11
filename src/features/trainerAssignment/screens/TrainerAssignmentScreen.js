import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import {
  HeaderBar,
  InlineFeedback,
  ModeButton,
  ModeCard,
  ModeText,
  SafeScreen,
} from '../../../../lib/components';
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
    <SafeScreen includeTopInset={false} style={styles.screen}>
      <HeaderBar title="Pick Your Coach" subtitle="Choose who should guide this account" />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: theme.spacing[5] + bottomInset },
        ]}
      >
        <ModeCard variant="tinted">
          <ModeText variant="h3" style={styles.title}>No active coach is assigned yet</ModeText>
          <ModeText variant="bodySm" tone="secondary" style={styles.body}>
            Select a coach below and we will attach this login to the right coaching context before chat starts.
          </ModeText>
          {!statusLoadFailed && errorMessage ? <InlineFeedback type="warning" message={errorMessage} style={styles.feedback} /> : null}
        </ModeCard>

        {statusLoadFailed ? (
          <ModeCard variant="surface" style={styles.blockingCard}>
            <ModeText variant="h3">Unable to load coach options</ModeText>
            {errorMessage ? <InlineFeedback type="error" message={errorMessage} /> : null}
            {errorRequestId ? <ModeText variant="caption" tone="tertiary">Request ID: {errorRequestId}</ModeText> : null}
            {errorApiBase ? <ModeText variant="caption" tone="tertiary">API Base: {errorApiBase}</ModeText> : null}
            <ModeButton
              title={isStatusLoading ? 'Retrying...' : 'Retry'}
              onPress={onRetryStatusLoad}
              disabled={isStatusLoading}
            />
          </ModeCard>
        ) : null}

        {!statusLoadFailed ? trainers.map((trainer) => (
          <ModeCard key={trainer.id} variant="surface" style={styles.trainerCard}>
            <ModeText variant="h3">{trainer.display_name}</ModeText>
            <ModeButton
              title={isSubmitting ? 'Assigning...' : `Choose ${trainer.display_name}`}
              onPress={() => onAssignTrainer(trainer.id)}
              disabled={isSubmitting || isStatusLoading}
            />
          </ModeCard>
        )) : null}

        {showEmptyState ? (
          <ModeCard variant="surface">
            <ModeText variant="bodySm" tone="secondary">
              No active coaches are available right now. Try another account from Settings, or add an active trainer in admin setup first.
            </ModeText>
          </ModeCard>
        ) : null}
      </ScrollView>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  screen: {},
  content: {
    padding: theme.spacing[3],
  },
  title: {
    marginBottom: theme.spacing[1],
  },
  body: {
    marginBottom: theme.spacing[1],
  },
  feedback: {
    marginTop: theme.spacing[2],
  },
  blockingCard: {
    gap: theme.spacing[2],
  },
  trainerCard: {
    gap: theme.spacing[2],
  },
});

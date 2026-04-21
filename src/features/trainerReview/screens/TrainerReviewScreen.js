import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import {
  HeaderBar,
  ModeButton,
  ModeCard,
  ModeText,
  SafeScreen,
} from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import { BREATHING_TRANSITIONS_ENABLED } from '../../../config/featureFlags';
import { BREATHING_CONTEXT, BreathingTransitionOverlay } from '../../shared/loading';
import {
  buildRegenerationLaunchContext,
  rebuildJSON,
  transformPlan,
} from '../../draftReview/domain/draftReviewModel';
import ReviewDetailPanel from '../components/ReviewDetailPanel';
import ReviewFiltersCard from '../components/ReviewFiltersCard';
import ReviewQueueList from '../components/ReviewQueueList';
import {
  approveTrainerReviewOutput,
  editTrainerReviewOutput,
  getTrainerReviewOutputDetail,
  getTrainerReviewOutputs,
  rejectTrainerReviewOutput,
} from '../services/trainerReviewApi';

export default function TrainerReviewScreen({
  accessToken,
  bottomInset = 0,
  topToolbar = null,
  onOpenTrainerCoach = null,
}) {
  const [statusFilter, setStatusFilter] = useState('open');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [outputsPayload, setOutputsPayload] = useState({ items: [], count: 0 });
  const [isLoadingOutputs, setIsLoadingOutputs] = useState(true);
  const [outputsError, setOutputsError] = useState(null);

  const [selectedOutputId, setSelectedOutputId] = useState(null);
  const [detailPayload, setDetailPayload] = useState(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState(null);

  const [draftModel, setDraftModel] = useState(null);
  const [isMutating, setIsMutating] = useState(false);
  const [mutationError, setMutationError] = useState(null);
  const [mutationSuccess, setMutationSuccess] = useState(null);

  const selectedOutput = detailPayload?.output || null;
  const feedbackEvents = Array.isArray(detailPayload?.feedback_events) ? detailPayload.feedback_events : [];
  const outputItems = Array.isArray(outputsPayload?.items) ? outputsPayload.items : [];
  const breathingTransitionsEnabled = Boolean(BREATHING_TRANSITIONS_ENABLED);
  const isBreathingTransitionActive = !selectedOutputId
    ? isLoadingOutputs
    : isLoadingDetail;

  const loadOutputs = useCallback(async () => {
    if (!accessToken) {
      return;
    }
    setIsLoadingOutputs(true);
    setOutputsError(null);
    try {
      const payload = await getTrainerReviewOutputs({
        accessToken,
        status: statusFilter,
        sourceType: sourceFilter === 'all' ? null : sourceFilter,
      });
      setOutputsPayload(payload);
    } catch (error) {
      setOutputsError(error?.message || 'Unable to load review outputs.');
    } finally {
      setIsLoadingOutputs(false);
    }
  }, [accessToken, sourceFilter, statusFilter]);

  const loadOutputDetail = useCallback(async (outputId) => {
    if (!accessToken || !outputId) {
      return;
    }
    setIsLoadingDetail(true);
    setDetailError(null);
    setMutationError(null);
    setMutationSuccess(null);
    try {
      const payload = await getTrainerReviewOutputDetail({
        accessToken,
        outputId,
      });
      setDetailPayload(payload);
      setDraftModel(payload?.output ? transformPlan(payload.output) : null);
    } catch (error) {
      setDetailError(error?.message || 'Unable to load output detail.');
    } finally {
      setIsLoadingDetail(false);
    }
  }, [accessToken]);

  useEffect(() => {
    loadOutputs();
  }, [loadOutputs]);

  const handleOpenOutput = async (outputId) => {
    setSelectedOutputId(outputId);
    await loadOutputDetail(outputId);
  };

  const handleBackToList = () => {
    setSelectedOutputId(null);
    setDetailPayload(null);
    setDetailError(null);
    setDraftModel(null);
    setMutationError(null);
    setMutationSuccess(null);
  };

  const resolveEditedOutputPayload = useCallback(() => {
    if (!selectedOutput) {
      return {
        editedOutputText: null,
        editedOutputJson: null,
      };
    }
    const uiState = draftModel && typeof draftModel === 'object'
      ? draftModel
      : transformPlan(selectedOutput);
    return rebuildJSON(uiState, selectedOutput);
  }, [draftModel, selectedOutput]);

  const runMutation = async (mutationFn, successMessage, { afterSuccess } = {}) => {
    if (!accessToken || !selectedOutputId || isMutating) {
      return false;
    }
    setIsMutating(true);
    setMutationError(null);
    setMutationSuccess(null);
    try {
      await mutationFn();
      await loadOutputDetail(selectedOutputId);
      await loadOutputs();
      setMutationSuccess(successMessage);
      if (typeof afterSuccess === 'function') {
        afterSuccess();
      }
      return true;
    } catch (error) {
      setMutationError(error?.message || 'Unable to update output.');
      return false;
    } finally {
      setIsMutating(false);
    }
  };

  const handleSaveEdit = async () => {
    const { editedOutputText, editedOutputJson } = resolveEditedOutputPayload();
    await runMutation(
      () => editTrainerReviewOutput({
        accessToken,
        outputId: selectedOutputId,
        editedOutputText,
        editedOutputJson,
        autoApplyDeltas: true,
      }),
      'Edit saved.',
    );
  };

  const handleApprove = async () => {
    const { editedOutputText, editedOutputJson } = resolveEditedOutputPayload();
    await runMutation(
      () => approveTrainerReviewOutput({
        accessToken,
        outputId: selectedOutputId,
        editedOutputText,
        editedOutputJson,
        autoApplyDeltas: true,
      }),
      'Output approved.',
    );
  };

  const handleReject = async () => {
    const { editedOutputText, editedOutputJson } = resolveEditedOutputPayload();
    await runMutation(
      () => rejectTrainerReviewOutput({
        accessToken,
        outputId: selectedOutputId,
        reason: 'Rejected in trainer review workspace.',
        editedOutputText,
        editedOutputJson,
      }),
      'Output rejected.',
    );
  };

  const handleRetryRender = () => {
    if (!selectedOutput) {
      return;
    }
    setDraftModel(transformPlan(selectedOutput));
    setMutationError(null);
  };

  const handleRegeneratePlan = async () => {
    if (!selectedOutput) {
      return;
    }
    const { editedOutputText, editedOutputJson } = resolveEditedOutputPayload();
    await runMutation(
      () => rejectTrainerReviewOutput({
        accessToken,
        outputId: selectedOutputId,
        reason: 'Rejected for regeneration in trainer review workspace.',
        editedOutputText,
        editedOutputJson,
      }),
      'Draft rejected and regeneration launched.',
      {
        afterSuccess: () => {
          if (typeof onOpenTrainerCoach === 'function') {
            onOpenTrainerCoach(buildRegenerationLaunchContext(selectedOutput, draftModel));
          }
        },
      },
    );
  };

  return (
    <SafeScreen
      includeTopInset={false}
      style={styles.screen}
      atmosphere="coach"
      atmosphereOverlayStrength={0.93}
    >
      <HeaderBar
        title={selectedOutputId ? 'Review Detail' : 'AI Review'}
        onBack={selectedOutputId ? handleBackToList : null}
      />
      {topToolbar ? (
        <View style={styles.toolbarContainer}>
          {topToolbar}
        </View>
      ) : null}
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(bottomInset, 0) + theme.spacing[3] },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {!selectedOutputId ? (
          <>
            <ReviewFiltersCard
              statusFilter={statusFilter}
              sourceFilter={sourceFilter}
              onStatusChange={setStatusFilter}
              onSourceChange={setSourceFilter}
              onRefresh={loadOutputs}
            />

            {!breathingTransitionsEnabled && isLoadingOutputs ? (
              <View style={styles.loadingState}>
                <ActivityIndicator size="small" color={theme.colors.brand.progressCore} />
                <ModeText variant="caption" tone="secondary">Loading review queue...</ModeText>
              </View>
            ) : null}

            {outputsError ? (
              <ModeCard style={styles.errorCard}>
                <ModeText variant="label" tone="error">{outputsError}</ModeText>
              </ModeCard>
            ) : null}

            {!isLoadingOutputs && !outputsError && outputItems.length === 0 ? (
              <ModeCard style={styles.emptyCard}>
                <ModeText variant="label">No outputs match this filter.</ModeText>
                <ModeText variant="caption" tone="secondary">
                  Generated chat replies, talking points, and plans will appear here for trainer review.
                </ModeText>
              </ModeCard>
            ) : null}

            {!isLoadingOutputs && !outputsError ? (
              <ReviewQueueList
                outputItems={outputItems}
                onOpenOutput={handleOpenOutput}
              />
            ) : null}
          </>
        ) : (
          <>
            {!breathingTransitionsEnabled && isLoadingDetail ? (
              <View style={styles.loadingState}>
                <ActivityIndicator size="small" color={theme.colors.brand.progressCore} />
                <ModeText variant="caption" tone="secondary">Loading output detail...</ModeText>
              </View>
            ) : null}

            {detailError ? (
              <ModeCard style={styles.errorCard}>
                <ModeText variant="label" tone="error">{detailError}</ModeText>
                <ModeButton
                  title="Retry"
                  variant="secondary"
                  onPress={() => loadOutputDetail(selectedOutputId)}
                  style={styles.retryButton}
                />
              </ModeCard>
            ) : null}

            {!isLoadingDetail && !detailError ? (
              <ReviewDetailPanel
                selectedOutput={selectedOutput}
                feedbackEvents={feedbackEvents}
                draftModel={draftModel}
                onDraftModelChange={setDraftModel}
                onRetryRender={handleRetryRender}
                onRegeneratePlan={handleRegeneratePlan}
                isMutating={isMutating}
                mutationError={mutationError}
                mutationSuccess={mutationSuccess}
                onSaveEdit={handleSaveEdit}
                onApprove={handleApprove}
                onReject={handleReject}
              />
            ) : null}
          </>
        )}
      </ScrollView>
      {breathingTransitionsEnabled ? (
        <BreathingTransitionOverlay
          active={isBreathingTransitionActive}
          context={BREATHING_CONTEXT.TRAINER_REVIEW_LOAD}
          variant="overlay"
          progressLabel={selectedOutputId ? 'Loading output detail...' : 'Loading review queue...'}
          testID="trainer-review-breathing-loader"
        />
      ) : null}
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: theme.colors.surface.canvas,
  },
  toolbarContainer: {
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
  content: {
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[1],
    gap: theme.spacing[2],
  },
  loadingState: {
    paddingVertical: theme.spacing[4],
    alignItems: 'center',
    gap: theme.spacing[1],
  },
  errorCard: {
    borderColor: theme.colors.emotional.dustyRose,
    backgroundColor: theme.colors.surface.base,
    gap: theme.spacing[2],
  },
  retryButton: {
    alignSelf: 'flex-start',
  },
  emptyCard: {
    gap: theme.spacing[1],
  },
});

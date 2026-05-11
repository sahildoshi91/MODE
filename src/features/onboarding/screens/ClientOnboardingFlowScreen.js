import React, { useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { InlineFeedback, ModeButton, ModeCard, ModeInput, ModeText } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import OnboardingStepContainer from '../components/OnboardingStepContainer';
import { QUICK_WIN_OPTIONS, QUICK_WIN_RECOMMENDATIONS } from '../constants/quickWin';
import { completeOnboarding, patchOnboardingState } from '../services/onboardingApi';
import { assignTrainerByInvite } from '../../trainerAssignment/services/trainerAssignmentApi';

const STEP_ORDER = ['trainer_attach', 'quick_win', 'lightweight_setup', 'system_ready'];
const GOAL_OPTIONS = [
  { key: 'fat_loss', label: 'Fat loss' },
  { key: 'strength', label: 'Strength' },
  { key: 'muscle_gain', label: 'Muscle gain' },
  { key: 'performance', label: 'Performance' },
  { key: 'general_fitness', label: 'General fitness' },
];

function getStartingStep(bootstrapStep) {
  if (STEP_ORDER.includes(bootstrapStep)) {
    return bootstrapStep;
  }
  return 'trainer_attach';
}

function normalizePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return {};
  }
  return payload;
}

export default function ClientOnboardingFlowScreen({
  accessToken,
  bootstrap,
  onBootstrapUpdate,
  onFinished,
  onTrackEvent,
}) {
  const initialPayload = normalizePayload(bootstrap?.onboarding_payload);
  const [step, setStep] = useState(getStartingStep(bootstrap?.onboarding_step));
  const [payload, setPayload] = useState(initialPayload);
  const [inviteCode, setInviteCode] = useState(initialPayload?.trainer_invite_code || '');
  const [selectedFeeling, setSelectedFeeling] = useState(initialPayload?.quick_win_feeling || null);
  const [setupGoal, setSetupGoal] = useState(
    initialPayload?.lightweight_setup?.goal || initialPayload?.goal || null,
  );
  const [setupWeeklyAvailability, setSetupWeeklyAvailability] = useState(
    String(initialPayload?.lightweight_setup?.weekly_availability || initialPayload?.weekly_availability || ''),
  );
  const [setupTrainingLocation, setSetupTrainingLocation] = useState(
    initialPayload?.lightweight_setup?.training_location || initialPayload?.training_location || '',
  );
  const [setupEquipment, setSetupEquipment] = useState(
    initialPayload?.lightweight_setup?.equipment || initialPayload?.equipment || '',
  );
  const [setupMinimumWin, setSetupMinimumWin] = useState(
    initialPayload?.lightweight_setup?.minimum_win || initialPayload?.minimum_win || '',
  );
  const [errorMessage, setErrorMessage] = useState(null);
  const [infoMessage, setInfoMessage] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const quickWinTrackedRef = useRef(false);

  const selectedRecommendation = useMemo(() => {
    if (!selectedFeeling) {
      return null;
    }
    return QUICK_WIN_RECOMMENDATIONS[selectedFeeling] || null;
  }, [selectedFeeling]);

  const mergedPayload = useMemo(
    () => ({
      ...payload,
      ...(selectedFeeling ? {
        quick_win_feeling: selectedFeeling,
        today_recommendation: selectedRecommendation,
      } : {}),
      lightweight_setup: {
        goal: setupGoal,
        weekly_availability: setupWeeklyAvailability,
        training_location: setupTrainingLocation,
        equipment: setupEquipment,
        minimum_win: setupMinimumWin,
      },
    }),
    [
      payload,
      selectedFeeling,
      selectedRecommendation,
      setupGoal,
      setupWeeklyAvailability,
      setupTrainingLocation,
      setupEquipment,
      setupMinimumWin,
    ],
  );

  const persistState = async ({ nextStep, status = 'in_progress', payloadPatch = {} }) => {
    const nextPayload = {
      ...payload,
      ...payloadPatch,
    };
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const updated = await patchOnboardingState({
        accessToken,
        status,
        currentStep: nextStep,
        payload: nextPayload,
      });
      setPayload(nextPayload);
      setStep(nextStep);
      onBootstrapUpdate(updated);
      return updated;
    } catch (error) {
      setErrorMessage(error?.message || 'Unable to save onboarding progress.');
      return null;
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSkipTrainer = async () => {
    await persistState({
      nextStep: 'quick_win',
      payloadPatch: {
        trainer_attach_status: 'skipped',
      },
    });
  };

  const handleAttachInvite = async () => {
    const normalizedCode = inviteCode.trim();
    if (!normalizedCode) {
      setErrorMessage('Enter an invite code to attach to a trainer.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setInfoMessage(null);
    try {
      const assignment = await assignTrainerByInvite({ accessToken, inviteCode: normalizedCode });
      const payloadPatch = {
        trainer_attach_status: 'attached',
        trainer_invite_code: normalizedCode,
        assigned_trainer_id: assignment?.assigned_trainer_id || null,
        assigned_trainer_display_name: assignment?.assigned_trainer_display_name || null,
      };
      const updated = await patchOnboardingState({
        accessToken,
        status: 'in_progress',
        currentStep: 'quick_win',
        payload: {
          ...payload,
          ...payloadPatch,
        },
      });
      setPayload((prev) => ({
        ...prev,
        ...payloadPatch,
      }));
      setStep('quick_win');
      setInfoMessage('Trainer attached successfully.');
      onBootstrapUpdate(updated);
    } catch (error) {
      setErrorMessage(error?.message || 'Unable to attach trainer with invite code.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleContinueFromQuickWin = async () => {
    if (!selectedFeeling || !selectedRecommendation) {
      setErrorMessage('Choose how you feel to continue.');
      return;
    }

    await persistState({
      nextStep: 'lightweight_setup',
      payloadPatch: {
        quick_win_feeling: selectedFeeling,
        today_recommendation: selectedRecommendation,
      },
    });
  };

  const handleContinueFromSetup = async () => {
    await persistState({
      nextStep: 'system_ready',
      payloadPatch: {
        lightweight_setup: {
          goal: setupGoal,
          weekly_availability: setupWeeklyAvailability,
          training_location: setupTrainingLocation,
          equipment: setupEquipment,
          minimum_win: setupMinimumWin,
        },
      },
    });
  };

  const handleStartCheckin = async () => {
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const completed = await completeOnboarding({
        accessToken,
        currentStep: 'system_ready',
        payload: mergedPayload,
      });
      onTrackEvent?.('onboarding_completed', {
        goal: setupGoal || null,
      });
      onTrackEvent?.('first_checkin_started', {
        source: 'system_ready',
      });
      onBootstrapUpdate(completed);
      onFinished();
    } catch (error) {
      setErrorMessage(error?.message || 'Unable to complete onboarding.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const recommendationCard = selectedRecommendation ? (
    <ModeCard variant="state" state="BASE" style={styles.recommendationCard}>
      <ModeText variant="h3">Today&apos;s move</ModeText>
      <ModeText variant="bodySm" style={styles.recommendationMove}>{selectedRecommendation.todayMove}</ModeText>
      <ModeText variant="bodySm" tone="secondary" style={styles.recommendationSupport}>
        {selectedRecommendation.support}
      </ModeText>
    </ModeCard>
  ) : null;

  if (selectedRecommendation && !quickWinTrackedRef.current) {
    quickWinTrackedRef.current = true;
    onTrackEvent?.('quick_win_seen', {
      feeling: selectedFeeling,
      today_move: selectedRecommendation.todayMove,
    });
  }

  if (step === 'trainer_attach') {
    return (
      <OnboardingStepContainer
        step={1}
        totalSteps={4}
        title="Start with a trainer (optional for now)"
        subtitle="You can skip now and attach later with an invite code."
        footer={(
          <>
            <ModeButton
              title={isSubmitting ? 'Please wait...' : 'Attach'}
              onPress={handleAttachInvite}
              disabled={isSubmitting}
            />
            <ModeButton
              variant="secondary"
              title="Skip for now"
              onPress={handleSkipTrainer}
              disabled={isSubmitting}
              style={styles.footerSecondary}
            />
          </>
        )}
      >
        <ModeInput
          placeholder="Enter invite code"
          value={inviteCode}
          onChangeText={setInviteCode}
          editable={!isSubmitting}
        />
        {infoMessage ? <InlineFeedback type="success" message={infoMessage} /> : null}
        {errorMessage ? <InlineFeedback type="error" message={errorMessage} /> : null}
      </OnboardingStepContainer>
    );
  }

  if (step === 'quick_win') {
    return (
      <OnboardingStepContainer
        step={2}
        totalSteps={4}
        title="How do you feel today?"
        subtitle="Choose one. We'll give you one clear move."
        footer={(
          <>
            <ModeButton
              title={isSubmitting ? 'Please wait...' : 'Continue'}
              onPress={handleContinueFromQuickWin}
              disabled={isSubmitting || !selectedFeeling}
            />
            <ModeButton
              variant="secondary"
              title="Back"
              onPress={() => setStep('trainer_attach')}
              disabled={isSubmitting}
              style={styles.footerSecondary}
            />
          </>
        )}
      >
        <View style={styles.optionWrap}>
          {QUICK_WIN_OPTIONS.map((option) => {
            const isSelected = selectedFeeling === option.key;
            return (
              <Pressable
                key={option.key}
                onPress={() => {
                  setSelectedFeeling(option.key);
                  setErrorMessage(null);
                }}
                accessibilityRole="button"
                style={[styles.optionPill, isSelected ? styles.optionPillSelected : null]}
              >
                <ModeText variant="bodySm" tone={isSelected ? 'accent' : 'primary'}>
                  {option.label}
                </ModeText>
              </Pressable>
            );
          })}
        </View>
        {recommendationCard}
        {errorMessage ? <InlineFeedback type="error" message={errorMessage} /> : null}
      </OnboardingStepContainer>
    );
  }

  if (step === 'lightweight_setup') {
    return (
      <OnboardingStepContainer
        step={3}
        totalSteps={4}
        title="Lightweight setup"
        subtitle="Set your baseline so MODE stays relevant."
        footer={(
          <>
            <ModeButton
              title={isSubmitting ? 'Please wait...' : 'Continue'}
              onPress={handleContinueFromSetup}
              disabled={isSubmitting}
            />
            <ModeButton
              variant="secondary"
              title="Back"
              onPress={() => setStep('quick_win')}
              disabled={isSubmitting}
              style={styles.footerSecondary}
            />
          </>
        )}
      >
        <ModeText variant="h3">Goal</ModeText>
        <View style={styles.goalWrap}>
          {GOAL_OPTIONS.map((goal) => {
            const isSelected = setupGoal === goal.key;
            return (
              <Pressable
                key={goal.key}
                onPress={() => setSetupGoal(goal.key)}
                accessibilityRole="button"
                style={[styles.optionPill, isSelected ? styles.optionPillSelected : null]}
              >
                <ModeText variant="bodySm" tone={isSelected ? 'accent' : 'primary'}>{goal.label}</ModeText>
              </Pressable>
            );
          })}
        </View>
        <ModeInput
          placeholder="Weekly availability (days)"
          keyboardType="number-pad"
          value={setupWeeklyAvailability}
          onChangeText={setSetupWeeklyAvailability}
        />
        <ModeInput
          placeholder="Training location"
          value={setupTrainingLocation}
          onChangeText={setSetupTrainingLocation}
        />
        <ModeInput
          placeholder="Equipment"
          value={setupEquipment}
          onChangeText={setSetupEquipment}
        />
        <ModeInput
          placeholder="Minimum win"
          value={setupMinimumWin}
          onChangeText={setSetupMinimumWin}
        />
        {errorMessage ? <InlineFeedback type="error" message={errorMessage} /> : null}
      </OnboardingStepContainer>
    );
  }

  return (
    <OnboardingStepContainer
      step={4}
      totalSteps={4}
      title="System ready"
      subtitle="You're set. Here's your baseline for today."
      footer={(
        <>
          <ModeButton
            title={isSubmitting ? 'Please wait...' : "Start Today's Check-In"}
            onPress={handleStartCheckin}
            disabled={isSubmitting}
          />
          <ModeButton
            variant="secondary"
            title="Back"
            onPress={() => setStep('lightweight_setup')}
            disabled={isSubmitting}
            style={styles.footerSecondary}
          />
        </>
      )}
    >
      <ModeCard variant="tinted" style={styles.summaryCard}>
        <ModeText variant="h3">Goal</ModeText>
        <ModeText variant="bodySm" tone="secondary">{setupGoal || 'Not set yet'}</ModeText>
      </ModeCard>
      <ModeCard variant="tinted" style={styles.summaryCard}>
        <ModeText variant="h3">Minimum win</ModeText>
        <ModeText variant="bodySm" tone="secondary">{setupMinimumWin || 'Not set yet'}</ModeText>
      </ModeCard>
      <ModeCard variant="state" state="BASE" style={styles.summaryCard}>
        <ModeText variant="h3">Today&apos;s recommendation</ModeText>
        <ModeText variant="bodySm" tone="secondary">
          {selectedRecommendation?.todayMove || payload?.today_recommendation?.todayMove || 'Not set yet'}
        </ModeText>
      </ModeCard>
      {errorMessage ? <InlineFeedback type="error" message={errorMessage} /> : null}
    </OnboardingStepContainer>
  );
}

const styles = StyleSheet.create({
  optionWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[1],
  },
  goalWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[1],
    marginBottom: theme.spacing[1],
  },
  optionPill: {
    borderWidth: 1,
    borderColor: theme.colors.border.default,
    borderRadius: theme.radii.pill,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    backgroundColor: theme.colors.surface.elevated,
  },
  optionPillSelected: {
    borderColor: theme.colors.accent.primary,
    backgroundColor: theme.colors.accent.soft,
  },
  recommendationCard: {
    marginBottom: 0,
  },
  recommendationMove: {
    marginTop: theme.spacing[1],
  },
  recommendationSupport: {
    marginTop: theme.spacing[1],
  },
  footerSecondary: {
    marginTop: theme.spacing[2],
  },
  summaryCard: {
    marginBottom: 0,
  },
});

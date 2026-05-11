import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ModeText } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import CoachChatScreen from '../../chat/screens/CoachChatScreen';
import { TRAINER_ASSISTANT_V1_ENABLED, TRAINER_REVIEW_ENABLED } from '../../../config/featureFlags';
import TrainerAssistantScreen from '../../trainerAssistant/screens/TrainerAssistantScreen';
import TrainerReviewScreen from '../../trainerReview/screens/TrainerReviewScreen';

const COACH_SUBVIEW = {
  ASSISTANT: 'assistant',
  CHAT: 'chat',
  REVIEW: 'review',
};

function CoachSubviewSwitcher({ activeSubview, onChange, options }) {
  return (
    <View style={styles.switchRow}>
      {options.map((option) => {
        const isActive = activeSubview === option.key;
        return (
          <Pressable
            key={option.key}
            onPress={() => onChange(option.key)}
            style={({ pressed }) => [
              styles.switchOption,
              isActive && styles.switchOptionActive,
              pressed && styles.switchOptionPressed,
            ]}
          >
            <ModeText
              variant="caption"
              tone={isActive ? 'primary' : 'secondary'}
              style={styles.switchOptionText}
            >
              {option.label}
            </ModeText>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TrainerCoachWorkspace({
  accessToken,
  chatLaunchContext,
  coachChatBottomInset,
  trainerOnboardingCompleted = false,
  trainerOnboardingStatus = 'not_started',
  trainerOnboardingCompletedSteps = 0,
  onOpenTrainerCoach = null,
}) {
  const normalizedOnboardingStatus = typeof trainerOnboardingStatus === 'string'
    ? trainerOnboardingStatus.trim().toLowerCase()
    : 'not_started';
  const onboardingComplete = Boolean(
    trainerOnboardingCompleted || normalizedOnboardingStatus === 'completed',
  );
  const onboardingInProgress = !onboardingComplete && (
    normalizedOnboardingStatus === 'in_progress'
    || normalizedOnboardingStatus === 'calibration_pending'
    || Number(trainerOnboardingCompletedSteps) > 0
  );
  const hasExplicitOnboardingAction = typeof chatLaunchContext?.onboarding_action === 'string'
    && chatLaunchContext.onboarding_action.trim().length > 0;
  const forceTrainingChat = Boolean(
    chatLaunchContext?.entrypoint === 'trainer_agent_training'
    && hasExplicitOnboardingAction,
  );
  const useTrainerAssistant = Boolean(
    TRAINER_ASSISTANT_V1_ENABLED
    && onboardingComplete
    && !forceTrainingChat,
  );
  const [activeSubview, setActiveSubview] = useState(
    useTrainerAssistant ? COACH_SUBVIEW.ASSISTANT : COACH_SUBVIEW.CHAT,
  );

  useEffect(() => {
    setActiveSubview((current) => {
      if (current === COACH_SUBVIEW.REVIEW && TRAINER_REVIEW_ENABLED) {
        return current;
      }
      return useTrainerAssistant ? COACH_SUBVIEW.ASSISTANT : COACH_SUBVIEW.CHAT;
    });
  }, [useTrainerAssistant]);

  const resolvedChatLaunchContext = useMemo(() => {
    if (chatLaunchContext && typeof chatLaunchContext === 'object') {
      return chatLaunchContext;
    }
    if (onboardingComplete) {
      return chatLaunchContext;
    }
    return {
      entrypoint: 'trainer_agent_training',
      onboarding_action: onboardingInProgress ? 'resume' : 'continue',
    };
  }, [chatLaunchContext, onboardingComplete, onboardingInProgress]);
  const switchOptions = useMemo(() => {
    if (useTrainerAssistant) {
      return TRAINER_REVIEW_ENABLED
        ? [
          { key: COACH_SUBVIEW.ASSISTANT, label: 'Assistant' },
          { key: COACH_SUBVIEW.REVIEW, label: 'Review' },
        ]
        : [{ key: COACH_SUBVIEW.ASSISTANT, label: 'Assistant' }];
    }
    return TRAINER_REVIEW_ENABLED
      ? [
        { key: COACH_SUBVIEW.CHAT, label: 'Chat' },
        { key: COACH_SUBVIEW.REVIEW, label: 'Review' },
      ]
      : [{ key: COACH_SUBVIEW.CHAT, label: 'Chat' }];
  }, [useTrainerAssistant]);
  const toolbar = (
    <CoachSubviewSwitcher
      activeSubview={activeSubview}
      onChange={setActiveSubview}
      options={switchOptions}
    />
  );

  if (activeSubview === COACH_SUBVIEW.REVIEW && TRAINER_REVIEW_ENABLED) {
    return (
      <TrainerReviewScreen
        accessToken={accessToken}
        bottomInset={coachChatBottomInset}
        topToolbar={toolbar}
        onOpenTrainerCoach={onOpenTrainerCoach}
      />
    );
  }

  if (useTrainerAssistant && activeSubview === COACH_SUBVIEW.ASSISTANT) {
    return (
      <TrainerAssistantScreen
        accessToken={accessToken}
        launchContext={chatLaunchContext}
        bottomInset={coachChatBottomInset}
        topToolbar={toolbar}
      />
    );
  }

  return (
    <CoachChatScreen
      accessToken={accessToken}
      launchContext={resolvedChatLaunchContext}
      bottomInset={coachChatBottomInset}
      topToolbar={toolbar}
    />
  );
}

const styles = StyleSheet.create({
  switchRow: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    borderColor: theme.colors.glass.borderStrong,
    backgroundColor: theme.colors.surface.elevated,
    padding: 2,
    gap: 4,
  },
  switchOption: {
    borderRadius: theme.radii.pill,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    minWidth: 76,
    alignItems: 'center',
    justifyContent: 'center',
  },
  switchOptionActive: {
    backgroundColor: theme.colors.nav.activeBg,
    borderWidth: 1,
    borderColor: theme.colors.nav.activeBorder,
  },
  switchOptionPressed: {
    opacity: 0.88,
  },
  switchOptionText: {
    fontWeight: '600',
  },
});

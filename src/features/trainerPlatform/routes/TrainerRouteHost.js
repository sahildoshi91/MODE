import React from 'react';

import TrainerClientsScreen from '../../trainerClients/screens/TrainerClientsScreen';
import { ChatShell } from '../../chat/components';
import TrainerCoachWorkspace from '../screens/TrainerCoachWorkspace';
import TrainerSystemScreen from '../screens/TrainerSystemScreen';

function resolveTrainerTab(activeTab) {
  if (activeTab === 'clients') {
    return 'clients';
  }
  if (activeTab === 'system') {
    return 'system';
  }
  return 'coach';
}

export default function TrainerRouteHost({
  activeTab,
  accessToken,
  chatLaunchContext,
  contentBottomInset,
  coachChatBottomInset,
  assignmentStatus,
  session,
  onOpenTrainerCoach,
  onTrainerOnboardingActivated = null,
  onSignOut,
}) {
  const resolvedTab = resolveTrainerTab(activeTab);
  const shouldUseOnboardingCoachWorkspace = (
    chatLaunchContext
    && typeof chatLaunchContext === 'object'
    && chatLaunchContext.entrypoint === 'trainer_agent_training'
  );

  if (resolvedTab === 'coach') {
    if (shouldUseOnboardingCoachWorkspace) {
      return (
        <TrainerCoachWorkspace
          accessToken={accessToken}
          chatLaunchContext={chatLaunchContext}
          coachChatBottomInset={coachChatBottomInset}
          trainerOnboardingCompleted={Boolean(assignmentStatus?.trainer_onboarding_completed)}
          trainerOnboardingStatus={assignmentStatus?.trainer_onboarding_status || 'not_started'}
          trainerOnboardingCompletedSteps={assignmentStatus?.trainer_onboarding_completed_steps ?? 0}
          onOpenTrainerCoach={onOpenTrainerCoach}
          onTrainerOnboardingActivated={onTrainerOnboardingActivated}
        />
      );
    }
    return (
      <ChatShell
        role="trainer"
        sessionType="coach_ai"
        accessToken={accessToken}
        trainerId={assignmentStatus?.trainer_id || assignmentStatus?.assigned_trainer_id || null}
        bottomInset={coachChatBottomInset}
      />
    );
  }

  if (resolvedTab === 'clients') {
    return (
      <TrainerClientsScreen
        accessToken={accessToken}
        bottomInset={contentBottomInset}
        onOpenTrainerCoach={onOpenTrainerCoach}
      />
    );
  }

  if (resolvedTab === 'system') {
    return (
      <TrainerSystemScreen
        accessToken={accessToken}
        bottomInset={contentBottomInset}
        assignmentStatus={assignmentStatus}
        session={session}
        onSignOut={onSignOut}
        onOpenTrainerCoach={onOpenTrainerCoach}
      />
    );
  }

  return (
    <ChatShell
      role="trainer"
      sessionType="coach_ai"
      accessToken={accessToken}
      trainerId={assignmentStatus?.trainer_id || assignmentStatus?.assigned_trainer_id || null}
      bottomInset={coachChatBottomInset}
    />
  );
}

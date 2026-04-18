import React from 'react';

import ProfileScreen from '../../profile/screens/ProfileScreen';
import TrainerClientsScreen from '../../trainerClients/screens/TrainerClientsScreen';
import TrainerHomeScreen from '../../trainerHome/screens/TrainerHomeScreen';
import TrainerCoachWorkspace from '../screens/TrainerCoachWorkspace';

export default function TrainerRouteHost({
  activeTab,
  accessToken,
  chatLaunchContext,
  contentBottomInset,
  coachChatBottomInset,
  assignmentStatus,
  session,
  onOpenTrainerCoach,
  onSignOut,
}) {
  if (activeTab === 'home') {
    return (
      <TrainerHomeScreen
        accessToken={accessToken}
        bottomInset={contentBottomInset}
        viewerDisplayName={assignmentStatus?.viewer_display_name || null}
        trainerOnboardingCompleted={Boolean(assignmentStatus?.trainer_onboarding_completed)}
        trainerOnboardingStatus={assignmentStatus?.trainer_onboarding_status || 'not_started'}
        trainerOnboardingCompletedSteps={assignmentStatus?.trainer_onboarding_completed_steps ?? 0}
        trainerOnboardingTotalSteps={assignmentStatus?.trainer_onboarding_total_steps ?? 8}
        trainerOnboardingLastStep={assignmentStatus?.trainer_onboarding_last_step || null}
        onOpenCoachTraining={onOpenTrainerCoach}
      />
    );
  }

  if (activeTab === 'coach') {
    return (
      <TrainerCoachWorkspace
        accessToken={accessToken}
        chatLaunchContext={chatLaunchContext}
        coachChatBottomInset={coachChatBottomInset}
        trainerOnboardingCompleted={Boolean(assignmentStatus?.trainer_onboarding_completed)}
        trainerOnboardingStatus={assignmentStatus?.trainer_onboarding_status || 'not_started'}
        trainerOnboardingCompletedSteps={assignmentStatus?.trainer_onboarding_completed_steps ?? 0}
      />
    );
  }

  if (activeTab === 'clients') {
    return (
      <TrainerClientsScreen
        accessToken={accessToken}
        bottomInset={contentBottomInset}
      />
    );
  }

  if (activeTab === 'profile') {
    return (
      <ProfileScreen
        session={session}
        assignmentStatus={assignmentStatus}
        accessToken={accessToken}
        onSignOut={onSignOut}
        bottomInset={contentBottomInset}
      />
    );
  }

  return (
    <TrainerHomeScreen
      accessToken={accessToken}
      bottomInset={contentBottomInset}
      viewerDisplayName={assignmentStatus?.viewer_display_name || null}
      trainerOnboardingCompleted={Boolean(assignmentStatus?.trainer_onboarding_completed)}
      trainerOnboardingStatus={assignmentStatus?.trainer_onboarding_status || 'not_started'}
      trainerOnboardingCompletedSteps={assignmentStatus?.trainer_onboarding_completed_steps ?? 0}
      trainerOnboardingTotalSteps={assignmentStatus?.trainer_onboarding_total_steps ?? 8}
      trainerOnboardingLastStep={assignmentStatus?.trainer_onboarding_last_step || null}
      onOpenCoachTraining={onOpenTrainerCoach}
    />
  );
}

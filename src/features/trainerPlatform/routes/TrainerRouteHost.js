import React from 'react';

import TrainerClientsScreen from '../../trainerClients/screens/TrainerClientsScreen';
import TrainerCoachScreen from '../../trainerCoach/screens/TrainerCoachScreen';
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
  onSignOut,
}) {
  const resolvedTab = resolveTrainerTab(activeTab);

  if (resolvedTab === 'coach') {
    return (
      <TrainerCoachScreen
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
    <TrainerCoachScreen
      accessToken={accessToken}
      trainerId={assignmentStatus?.trainer_id || assignmentStatus?.assigned_trainer_id || null}
      bottomInset={coachChatBottomInset}
    />
  );
}

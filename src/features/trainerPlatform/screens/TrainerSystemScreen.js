import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ModeText } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import ProfileScreen from '../../profile/screens/ProfileScreen';
import TrainerHomeScreen from '../../trainerHome/screens/TrainerHomeScreen';

const SYSTEM_PANE = {
  KNOWLEDGE: 'knowledge',
  SETTINGS: 'settings',
};

function PaneToggle({
  activePane,
  onChange,
}) {
  return (
    <View style={styles.toggleWrap}>
      {[
        { key: SYSTEM_PANE.KNOWLEDGE, label: 'Knowledge' },
        { key: SYSTEM_PANE.SETTINGS, label: 'Settings' },
      ].map((pane) => {
        const isActive = pane.key === activePane;
        return (
          <Pressable
            key={pane.key}
            onPress={() => onChange(pane.key)}
            style={({ pressed }) => [
              styles.toggleButton,
              isActive && styles.toggleButtonActive,
              pressed && styles.toggleButtonPressed,
            ]}
          >
            <ModeText variant="caption" tone={isActive ? 'primary' : 'secondary'} style={styles.toggleText}>
              {pane.label}
            </ModeText>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TrainerSystemScreen({
  accessToken,
  bottomInset = 0,
  assignmentStatus,
  session,
  onSignOut,
  onOpenTrainerCoach,
}) {
  const [activePane, setActivePane] = useState(SYSTEM_PANE.KNOWLEDGE);

  return (
    <View style={styles.root}>
      {activePane === SYSTEM_PANE.KNOWLEDGE ? (
        <TrainerHomeScreen
          accessToken={accessToken}
          bottomInset={bottomInset + 56}
          viewerDisplayName={assignmentStatus?.viewer_display_name || null}
          trainerOnboardingCompleted={Boolean(assignmentStatus?.trainer_onboarding_completed)}
          trainerOnboardingStatus={assignmentStatus?.trainer_onboarding_status || 'not_started'}
          trainerOnboardingCompletedSteps={assignmentStatus?.trainer_onboarding_completed_steps ?? 0}
          trainerOnboardingTotalSteps={assignmentStatus?.trainer_onboarding_total_steps ?? 8}
          trainerOnboardingLastStep={assignmentStatus?.trainer_onboarding_last_step || null}
          onOpenCoachTraining={onOpenTrainerCoach}
        />
      ) : (
        <ProfileScreen
          session={session}
          assignmentStatus={assignmentStatus}
          accessToken={accessToken}
          onSignOut={onSignOut}
          bottomInset={bottomInset + 56}
        />
      )}

      <View style={[styles.toggleDock, { bottom: bottomInset + 4 }]}>
        <PaneToggle
          activePane={activePane}
          onChange={setActivePane}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  toggleDock: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 30,
  },
  toggleWrap: {
    flexDirection: 'row',
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    borderColor: theme.colors.glass.borderStrong,
    backgroundColor: theme.colors.surface.elevated,
    padding: 2,
    gap: 4,
    ...theme.shadows.soft,
  },
  toggleButton: {
    borderRadius: theme.radii.pill,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 8,
    minWidth: 96,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleButtonActive: {
    backgroundColor: theme.colors.nav.activeBg,
    borderWidth: 1,
    borderColor: theme.colors.nav.activeBorder,
    shadowColor: theme.colors.accent.primary,
    shadowOpacity: 0.16,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  toggleButtonPressed: {
    opacity: theme.interaction.pressedOpacity,
  },
  toggleText: {
    fontWeight: '700',
  },
});

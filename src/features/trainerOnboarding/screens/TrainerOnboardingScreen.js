/**
 * TrainerOnboardingScreen
 *
 * Trainer onboarding UI. Replaces TrainerStubScreen for non-legacy trainers
 * whose onboarding is not yet complete.
 *
 * Props
 * ─────
 * accessToken          string   Supabase JWT
 * assignmentStatus     object   From getTrainerAssignmentStatus()
 * onOnboardingComplete function Called when backend signals completion;
 *                               parent refreshes assignmentStatus and
 *                               transitions to TrainerCoachWorkspace
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { theme } from '../../../../lib/theme';
import CoachChatScreen from '../../chat/screens/CoachChatScreen';

const TOTAL_STEPS = 8;

function deriveProgress(assignmentStatus) {
  if (
    assignmentStatus?.trainer_onboarding_completed ||
    assignmentStatus?.trainer_onboarding_status === 'completed'
  ) {
    return 1;
  }
  const completed = assignmentStatus?.trainer_onboarding_completed_steps ?? 0;
  return Math.min(1, Math.max(0, completed / TOTAL_STEPS));
}

function OnboardingProgressBar({ progress }) {
  const fillAnim = useRef(new Animated.Value(progress)).current;

  useEffect(() => {
    Animated.timing(fillAnim, {
      toValue: progress,
      duration: 600,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [progress, fillAnim]);

  const widthInterp = fillAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={styles.track}>
      <Animated.View style={[styles.fill, { width: widthInterp }]} />
    </View>
  );
}

export default function TrainerOnboardingScreen({
  accessToken,
  assignmentStatus,
  onOnboardingComplete,
}) {
  const insets = useSafeAreaInsets();

  const progress = useMemo(
    () => deriveProgress(assignmentStatus),
    [assignmentStatus],
  );

  // Called by CoachChatScreen when a profile_patch SSE event arrives.
  // If CoachChatScreen does not yet expose onProfilePatchReceived, completion
  // is caught via the parent's assignmentStatus refresh — this is a no-op.
  const handleProfilePatch = useCallback(
    (patch) => {
      const onboardingPatch = patch?.trainer_onboarding;
      if (!onboardingPatch) return;
      if (onboardingPatch?.onboarding_status === 'completed') {
        setTimeout(() => {
          onOnboardingComplete?.();
        }, 1800);
      }
    },
    [onOnboardingComplete],
  );

  const launchContext = useMemo(() => {
    const status = assignmentStatus?.trainer_onboarding_status || 'not_started';
    const isInProgress =
      status === 'in_progress' ||
      status === 'calibration_pending' ||
      (assignmentStatus?.trainer_onboarding_completed_steps ?? 0) > 0;
    return {
      entrypoint: 'trainer_agent_training',
      onboarding_action: isInProgress ? 'resume' : 'continue',
    };
  }, [assignmentStatus]);

  const chatBottomInset = insets.bottom + 12;

  return (
    <View style={styles.root}>
      <View style={[styles.barWrap, { paddingTop: insets.top + 8 }]}>
        <OnboardingProgressBar progress={progress} />
      </View>
      <View style={styles.chatWrap}>
        <CoachChatScreen
          accessToken={accessToken}
          launchContext={launchContext}
          bottomInset={chatBottomInset}
          onProfilePatchReceived={handleProfilePatch}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.colors.background.app,
  },
  barWrap: {
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  track: {
    height: 2,
    borderRadius: 1,
    backgroundColor:
      theme.colors.surface.elevated ??
      theme.colors.surface.glass ??
      'rgba(255,255,255,0.07)',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 1,
    backgroundColor: theme.colors.accent.primary,
  },
  chatWrap: {
    flex: 1,
    overflow: 'hidden',
  },
});

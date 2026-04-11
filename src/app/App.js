import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { theme } from '../../lib/theme';
import Login from '../features/auth/screens/Login';
import OnboardingLandingScreen from '../features/auth/screens/OnboardingLandingScreen';
import CoachChatScreen from '../features/chat/screens/CoachChatScreen';
import DailyCheckinScreen from '../features/dailyCheckin/screens/DailyCheckinScreen';
import CoachInsightsScreen from '../features/insights/screens/CoachInsightsScreen';
import LiquidBottomNav from '../features/navigation/components/LiquidBottomNav';
import ProfileScreen from '../features/profile/screens/ProfileScreen';
import ProgressScreen from '../features/progress/screens/ProgressScreen';
import TrainerClientsScreen from '../features/trainerClients/screens/TrainerClientsScreen';
import TrainerAssignmentScreen from '../features/trainerAssignment/screens/TrainerAssignmentScreen';
import TrainerHomeScreen from '../features/trainerHome/screens/TrainerHomeScreen';
import { assignTrainer, getTrainerAssignmentStatus } from '../features/trainerAssignment/services/trainerAssignmentApi';
import { supabase } from '../services/supabaseClient';

const FLOATING_NAV_BOTTOM_OFFSET = 12;
const FLOATING_NAV_PILL_HEIGHT = 62;
const COACH_CHAT_NAV_GAP = 2;
const COACH_CHAT_DOCK_CLEARANCE =
  FLOATING_NAV_BOTTOM_OFFSET + FLOATING_NAV_PILL_HEIGHT + COACH_CHAT_NAV_GAP;
const VIEWER_ROLE = {
  TRAINER: 'trainer',
  CLIENT: 'client',
  UNASSIGNED: 'unassigned',
};

function formatAssignmentError(error, fallbackMessage) {
  const message = error?.message || fallbackMessage;
  return {
    message,
    requestId: error?.request_id || null,
    apiBase: error?.api_base_url || error?.resolved_api_base_url || null,
  };
}

function AppShell() {
  const insets = useSafeAreaInsets();
  const [session, setSession] = useState(null);
  const [authStage, setAuthStage] = useState('intro');
  const [isSessionLoading, setIsSessionLoading] = useState(true);
  const [isAssignmentStatusLoading, setIsAssignmentStatusLoading] = useState(false);
  const [assignmentStatus, setAssignmentStatus] = useState(null);
  const [assignmentStatusError, setAssignmentStatusError] = useState(null);
  const [assignTrainerError, setAssignTrainerError] = useState(null);
  const [isAssigningTrainer, setIsAssigningTrainer] = useState(false);
  const [activeTab, setActiveTab] = useState('home');
  const [chatLaunchContext, setChatLaunchContext] = useState(null);
  const [coachOverlayContext, setCoachOverlayContext] = useState(null);
  const [progressRoute, setProgressRoute] = useState('progress');
  const [insightsOrigin, setInsightsOrigin] = useState('progress');
  const tabOpacity = useRef(new Animated.Value(1)).current;
  const tabTranslateY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let isMounted = true;

    const loadSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (!isMounted) {
        return;
      }
      setSession(data.session || null);
      if (!data.session) {
        setAuthStage('intro');
      }
      setIsSessionLoading(false);
    };

    loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!isMounted) {
        return;
      }
      setSession(nextSession || null);
      setActiveTab('home');
      setProgressRoute('progress');
      setInsightsOrigin('progress');
      setChatLaunchContext(null);
      setCoachOverlayContext(null);
      if (!nextSession) {
        setAuthStage('intro');
      }
      setIsSessionLoading(false);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const loadAssignmentStatus = useCallback(
    async ({ accessTokenOverride } = {}) => {
      const accessToken = accessTokenOverride || session?.access_token;
      if (!accessToken) {
        setAssignmentStatus(null);
        setAssignmentStatusError(null);
        return null;
      }

      setIsAssignmentStatusLoading(true);
      setAssignmentStatusError(null);

      try {
        const status = await getTrainerAssignmentStatus({ accessToken });
        setAssignmentStatus(status);
        return status;
      } catch (error) {
        setAssignmentStatus(null);
        setAssignmentStatusError(
          formatAssignmentError(error, 'Unable to load trainer assignment status.'),
        );
        return null;
      } finally {
        setIsAssignmentStatusLoading(false);
      }
    },
    [session?.access_token],
  );

  useEffect(() => {
    if (!session?.access_token) {
      setAssignmentStatus(null);
      setAssignmentStatusError(null);
      setAssignTrainerError(null);
      return;
    }
    loadAssignmentStatus({ accessTokenOverride: session.access_token });
  }, [session?.access_token, loadAssignmentStatus]);

  useEffect(() => {
    tabOpacity.setValue(0);
    tabTranslateY.setValue(10);

    Animated.parallel([
      Animated.timing(tabOpacity, {
        toValue: 1,
        duration: theme.animation.duration.normal,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(tabTranslateY, {
        toValue: 0,
        duration: theme.animation.duration.long,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [activeTab, tabOpacity, tabTranslateY]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setAssignmentStatus(null);
    setAssignmentStatusError(null);
    setAssignTrainerError(null);
    setIsAssigningTrainer(false);
    setActiveTab('home');
    setProgressRoute('progress');
    setInsightsOrigin('progress');
    setChatLaunchContext(null);
    setCoachOverlayContext(null);
    setAuthStage('intro');
  };

  const handleAssignTrainer = async (trainerId) => {
    if (!session?.access_token || isAssigningTrainer) {
      return;
    }

    try {
      setIsAssigningTrainer(true);
      setAssignTrainerError(null);
      setAssignmentStatusError(null);
      await assignTrainer({
        accessToken: session.access_token,
        trainerId,
      });
      await loadAssignmentStatus();
      setActiveTab('home');
      setInsightsOrigin('progress');
      setChatLaunchContext(null);
      setCoachOverlayContext(null);
    } catch (error) {
      setAssignTrainerError(formatAssignmentError(error, 'Unable to assign trainer.'));
    } finally {
      setIsAssigningTrainer(false);
    }
  };

  const handleOpenChat = (launchContext = null) => {
    if (
      launchContext?.entrypoint === 'generated_workout'
      || launchContext?.entrypoint === 'generated_nutrition'
    ) {
      setCoachOverlayContext(launchContext);
      return;
    }
    setCoachOverlayContext(null);
    setChatLaunchContext(launchContext);
    setActiveTab('coach');
  };

  const handleOpenTrainerCoach = () => {
    setCoachOverlayContext(null);
    setChatLaunchContext({ entrypoint: 'trainer_agent_training' });
    setActiveTab('coach');
  };

  const viewerRole = assignmentStatus?.viewer_role || VIEWER_ROLE.UNASSIGNED;
  const isTrainerViewer = viewerRole === VIEWER_ROLE.TRAINER;

  useEffect(() => {
    if (isTrainerViewer && activeTab === 'progress') {
      setActiveTab('clients');
      return;
    }
    if (!isTrainerViewer && activeTab === 'clients') {
      setActiveTab('home');
    }
  }, [isTrainerViewer, activeTab]);

  const handleTabChange = (nextTab) => {
    if (!isTrainerViewer && nextTab === 'clients') {
      return;
    }
    if (isTrainerViewer && nextTab === 'progress') {
      return;
    }
    setCoachOverlayContext(null);
    setActiveTab(nextTab);
    if (nextTab !== 'coach') {
      setChatLaunchContext(null);
    }
    if (!isTrainerViewer && nextTab !== 'progress') {
      setProgressRoute('progress');
    }
    if (!isTrainerViewer && nextTab !== 'progress' && nextTab !== 'home') {
      setInsightsOrigin('progress');
    }
  };

  const handleOpenHomeInsights = () => {
    setInsightsOrigin('home');
    setActiveTab('progress');
    setProgressRoute('insights');
  };

  const handleOpenProgressInsights = () => {
    setInsightsOrigin('progress');
    setProgressRoute('insights');
  };

  const handleBackFromInsights = () => {
    if (insightsOrigin === 'home') {
      setActiveTab('home');
      setProgressRoute('progress');
      return;
    }
    setActiveTab('progress');
    setProgressRoute('progress');
  };

  if (isSessionLoading) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator size="large" color={theme.colors.brand.progressCore} />
      </View>
    );
  }

  if (!session?.access_token) {
    if (authStage === 'intro') {
      return <OnboardingLandingScreen onContinue={() => setAuthStage('login')} />;
    }
    return <Login onBackToIntro={() => setAuthStage('intro')} />;
  }

  const navBottomInset = insets.bottom;
  const floatingNavClearance = navBottomInset + FLOATING_NAV_BOTTOM_OFFSET + FLOATING_NAV_PILL_HEIGHT;
  const contentBottomInset = navBottomInset + 108;
  const coachChatBottomInset = navBottomInset + COACH_CHAT_DOCK_CLEARANCE;
  const isBlockingStatusError = Boolean(assignmentStatusError);
  const assignmentError = assignTrainerError || assignmentStatusError;
  const needsAssignment = Boolean(assignmentStatus?.needs_assignment);
  const showAssignmentGate = Boolean(
    !isTrainerViewer && (needsAssignment || isBlockingStatusError) && activeTab !== 'profile',
  );
  const isBlockingAssignmentLoad = isAssignmentStatusLoading && !assignmentStatus && !assignmentStatusError;

  if (isBlockingAssignmentLoad) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator size="large" color={theme.colors.brand.progressCore} />
      </View>
    );
  }

  return (
    <View style={styles.shell}>
      <Animated.View
        style={[
          styles.screenContainer,
          {
            opacity: tabOpacity,
            transform: [{ translateY: tabTranslateY }],
          },
        ]}
      >
        {showAssignmentGate ? (
          <TrainerAssignmentScreen
            trainers={assignmentStatus?.available_trainers || []}
            availableTrainerCount={assignmentStatus?.available_trainers_count}
            hasLoadedStatus={Boolean(assignmentStatus)}
            isStatusLoading={isAssignmentStatusLoading}
            statusLoadFailed={isBlockingStatusError}
            isSubmitting={isAssigningTrainer}
            errorMessage={assignmentError?.message || null}
            errorRequestId={assignmentError?.requestId || null}
            errorApiBase={assignmentError?.apiBase || null}
            onRetryStatusLoad={loadAssignmentStatus}
            onAssignTrainer={handleAssignTrainer}
            bottomInset={contentBottomInset}
          />
        ) : null}

        {!showAssignmentGate && !isTrainerViewer && activeTab === 'home' ? (
          <DailyCheckinScreen
            accessToken={session.access_token}
            bottomInset={contentBottomInset}
            floatingNavClearance={floatingNavClearance}
            onOpenChat={handleOpenChat}
            onOpenInsights={handleOpenHomeInsights}
          />
        ) : null}

        {!showAssignmentGate && isTrainerViewer && activeTab === 'home' ? (
          <TrainerHomeScreen
            accessToken={session.access_token}
            bottomInset={contentBottomInset}
            viewerDisplayName={assignmentStatus?.viewer_display_name || null}
            trainerOnboardingCompleted={Boolean(assignmentStatus?.trainer_onboarding_completed)}
            onOpenCoachTraining={handleOpenTrainerCoach}
          />
        ) : null}

        {!showAssignmentGate && activeTab === 'coach' ? (
          <CoachChatScreen
            accessToken={session.access_token}
            launchContext={chatLaunchContext}
            bottomInset={coachChatBottomInset}
          />
        ) : null}

        {!showAssignmentGate && !isTrainerViewer && activeTab === 'progress' && progressRoute === 'progress' ? (
          <ProgressScreen
            accessToken={session.access_token}
            bottomInset={contentBottomInset}
            onOpenInsights={handleOpenProgressInsights}
            initialSection="habits"
          />
        ) : null}

        {!showAssignmentGate && !isTrainerViewer && activeTab === 'progress' && progressRoute === 'insights' ? (
          <CoachInsightsScreen
            accessToken={session.access_token}
            onBack={handleBackFromInsights}
            bottomInset={contentBottomInset}
          />
        ) : null}

        {!showAssignmentGate && isTrainerViewer && activeTab === 'clients' ? (
          <TrainerClientsScreen
            accessToken={session.access_token}
            bottomInset={contentBottomInset}
          />
        ) : null}

        {activeTab === 'profile' ? (
          <ProfileScreen
            session={session}
            assignmentStatus={assignmentStatus}
            onSignOut={handleSignOut}
            bottomInset={contentBottomInset}
          />
        ) : null}
      </Animated.View>

      {coachOverlayContext ? (
        <View style={styles.coachOverlay}>
          <CoachChatScreen
            accessToken={session.access_token}
            launchContext={coachOverlayContext}
            bottomInset={navBottomInset}
            onBack={() => setCoachOverlayContext(null)}
          />
        </View>
      ) : null}

      {!coachOverlayContext ? (
        <LiquidBottomNav
          activeTab={activeTab}
          onTabChange={handleTabChange}
          bottomInset={navBottomInset}
          role={isTrainerViewer ? 'trainer' : 'client'}
        />
      ) : null}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppShell />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: theme.colors.surface.canvas,
  },
  screenContainer: {
    flex: 1,
  },
  coachOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 40,
  },
  loadingScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface.canvas,
  },
});

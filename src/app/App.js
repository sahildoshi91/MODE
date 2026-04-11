import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { supabase } from '../services/supabaseClient';
import Login from '../features/auth/screens/Login';
import CoachChatScreen from '../features/chat/screens/CoachChatScreen';
import DailyCheckinScreen from '../features/dailyCheckin/screens/DailyCheckinScreen';
import LiquidBottomNav from '../features/navigation/components/LiquidBottomNav';
import ProfileScreen from '../features/profile/screens/ProfileScreen';
import ProgressScreen from '../features/progress/screens/ProgressScreen';
import TrainerAssignmentScreen from '../features/trainerAssignment/screens/TrainerAssignmentScreen';
import { assignTrainer, getTrainerAssignmentStatus } from '../features/trainerAssignment/services/trainerAssignmentApi';
import { theme } from '../../lib/theme';

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
  const [isSessionLoading, setIsSessionLoading] = useState(true);
  const [isAssignmentStatusLoading, setIsAssignmentStatusLoading] = useState(false);
  const [assignmentStatus, setAssignmentStatus] = useState(null);
  const [assignmentStatusError, setAssignmentStatusError] = useState(null);
  const [assignTrainerError, setAssignTrainerError] = useState(null);
  const [isAssigningTrainer, setIsAssigningTrainer] = useState(false);
  const [activeTab, setActiveTab] = useState('home');
  const [chatLaunchContext, setChatLaunchContext] = useState(null);
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
      setChatLaunchContext(null);
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
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(tabTranslateY, {
        toValue: 0,
        duration: 320,
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
    setChatLaunchContext(null);
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
      setChatLaunchContext(null);
    } catch (error) {
      setAssignTrainerError(formatAssignmentError(error, 'Unable to assign trainer.'));
    } finally {
      setIsAssigningTrainer(false);
    }
  };

  const handleOpenChat = (launchContext = null) => {
    setChatLaunchContext(launchContext);
    setActiveTab('coach');
  };

  const handleTabChange = (nextTab) => {
    setActiveTab(nextTab);
    if (nextTab !== 'coach') {
      setChatLaunchContext(null);
    }
  };

  if (isSessionLoading) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator size="large" color={theme.colors.accent} />
      </View>
    );
  }

  if (!session?.access_token) {
    return <Login />;
  }

  const navBottomInset = insets.bottom;
  const contentBottomInset = navBottomInset + 108;
  const isBlockingStatusError = Boolean(assignmentStatusError);
  const assignmentError = assignTrainerError || assignmentStatusError;
  const needsAssignment = Boolean(assignmentStatus?.needs_assignment);
  const showAssignmentGate = Boolean((needsAssignment || isBlockingStatusError) && activeTab !== 'profile');
  const isBlockingAssignmentLoad = isAssignmentStatusLoading && !assignmentStatus && !assignmentStatusError;

  if (isBlockingAssignmentLoad) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator size="large" color={theme.colors.accent} />
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

        {!showAssignmentGate && activeTab === 'home' ? (
          <DailyCheckinScreen
            accessToken={session.access_token}
            bottomInset={contentBottomInset}
            onOpenChat={handleOpenChat}
          />
        ) : null}

        {!showAssignmentGate && activeTab === 'coach' ? (
          <CoachChatScreen
            accessToken={session.access_token}
            launchContext={chatLaunchContext}
            bottomInset={contentBottomInset}
          />
        ) : null}

        {!showAssignmentGate && activeTab === 'progress' ? (
          <ProgressScreen
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

      <LiquidBottomNav
        activeTab={activeTab}
        onTabChange={handleTabChange}
        bottomInset={navBottomInset}
      />
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
    backgroundColor: theme.colors.bg.primary,
  },
  screenContainer: {
    flex: 1,
  },
  loadingScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.bg.primary,
  },
});

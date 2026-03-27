import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { supabase } from '../services/supabaseClient';
import Login from '../features/auth/screens/Login';
import CoachChatScreen from '../features/chat/screens/CoachChatScreen';
import TrainerAssignmentScreen from '../features/trainerAssignment/screens/TrainerAssignmentScreen';
import { assignTrainer, getTrainerAssignmentStatus } from '../features/trainerAssignment/services/trainerAssignmentApi';
import { theme } from '../../lib/theme';

function AppShell() {
  const [session, setSession] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [assignmentStatus, setAssignmentStatus] = useState(null);
  const [assignmentError, setAssignmentError] = useState(null);
  const [isAssigningTrainer, setIsAssigningTrainer] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const loadSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (!isMounted) {
        return;
      }
      setSession(data.session || null);
      setIsLoading(false);
    };

    loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!isMounted) {
        return;
      }
      setSession(nextSession || null);
      setIsLoading(false);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadAssignmentStatus = async () => {
      if (!session?.access_token) {
        setAssignmentStatus(null);
        setAssignmentError(null);
        return;
      }

      setIsLoading(true);
      setAssignmentError(null);

      try {
        const status = await getTrainerAssignmentStatus({ accessToken: session.access_token });
        if (!isMounted) {
          return;
        }
        setAssignmentStatus(status);
      } catch (error) {
        if (!isMounted) {
          return;
        }
        setAssignmentError(error.message || 'Unable to load trainer assignment status.');
        setAssignmentStatus({
          needs_assignment: true,
          available_trainers: [],
        });
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    loadAssignmentStatus();

    return () => {
      isMounted = false;
    };
  }, [session]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setAssignmentStatus(null);
    setAssignmentError(null);
    setIsAssigningTrainer(false);
  };

  const handleAssignTrainer = async (trainerId) => {
    if (!session?.access_token || isAssigningTrainer) {
      return;
    }

    try {
      setIsAssigningTrainer(true);
      setAssignmentError(null);
      const updatedStatus = await assignTrainer({
        accessToken: session.access_token,
        trainerId,
      });
      setAssignmentStatus(updatedStatus);
    } catch (error) {
      setAssignmentError(error.message || 'Unable to assign trainer.');
    } finally {
      setIsAssigningTrainer(false);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator size="large" color={theme.colors.accent} />
      </View>
    );
  }

  if (!session?.access_token) {
    return <Login />;
  }

  if (assignmentStatus?.needs_assignment) {
    return (
      <TrainerAssignmentScreen
        trainers={assignmentStatus.available_trainers || []}
        isSubmitting={isAssigningTrainer}
        errorMessage={assignmentError}
        onAssignTrainer={handleAssignTrainer}
        onSignOut={handleSignOut}
      />
    );
  }

  return (
    <CoachChatScreen
      accessToken={session.access_token}
      onSignOut={handleSignOut}
    />
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
  loadingScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.bg.primary,
  },
});

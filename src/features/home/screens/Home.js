import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Alert, FlatList } from 'react-native';
import { supabase } from '../../../../lib/supabase';
import { ModeButton, ModeCard, ModeListItem, HeaderBar } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:8000';

export default function Home({ navigation }) {
  const [profile, setProfile] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [recentSessions, setRecentSessions] = useState([]);

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const { data: user } = await supabase.auth.getUser();
        if (!user.user) {
          Alert.alert('Error', 'User not authenticated');
          setLoadingProfile(false);
          return;
        }
        const { data, error } = await supabase.from('profiles').select('*').eq('id', user.user.id).single();
        if (error) throw error;
        setProfile(data);
        const { data: workouts } = await supabase
          .from('workouts')
          .select('*')
          .eq('user_id', user.user.id)
          .order('created_at', { ascending: false })
          .limit(5);
        setRecentSessions(workouts || []);
      } catch (error) {
        Alert.alert('Error', error.message);
      } finally {
        setLoadingProfile(false);
      }
    };

    loadProfile();
  }, []);

  const generateWorkout = async () => {
    try {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) {
        Alert.alert('Error', 'User not authenticated');
        return;
      }
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        Alert.alert('Error', 'Missing session token');
        return;
      }

      const duration = profile?.duration || 30;
      const workout_type = profile?.workout_type || 'Full body';

      const response = await fetch(`${API_BASE_URL}/workouts/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          duration,
          workout_type,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        Alert.alert('Error', data.detail || 'Failed to generate workout');
        return;
      }
      navigation.navigate('WorkoutDisplay', { workout: data.workout, planId: data.plan_id });
    } catch (error) {
      Alert.alert('Error', error.message);
    }
  };

  if (loadingProfile) {
    return (
      <View style={styles.screenContainer}>
        <Text style={styles.loadingText}>Loading your profile…</Text>
      </View>
    );
  }

  return (
    <View style={styles.screenContainer}>
      <HeaderBar title="Mode Coach" subtitle="AI workout built from your profile" />

      <ModeCard>
        <Text style={styles.cardTitle}>Hello{profile?.full_name ? `, ${profile.full_name}` : ''}</Text>
        <Text style={styles.cardText}>Session plan with {profile?.duration || 30} mins · {profile?.workout_type || 'Full body'}</Text>
      </ModeCard>

      <ModeButton title="Generate Workout" onPress={generateWorkout} />

      <Text style={styles.sectionTitle}>Recent Sessions</Text>
      <FlatList
        data={recentSessions}
        keyExtractor={(item) => item.id?.toString() || item.created_at}
        renderItem={({ item }) => (
          <ModeListItem
            title={item.title || 'Workout Session'}
            subtitle={`${item.duration || 30} mins • ${item.plan_type || profile?.workout_type || 'Full body'}`}
            rightText={item.completed ? 'Done' : 'Open'}
            style={{ marginVertical: theme.spacing[0] }}
          />
        )}
        contentContainerStyle={{ paddingBottom: theme.spacing[4] }}
        ListEmptyComponent={<Text style={styles.emptyText}>No recent workouts yet. Start one now!</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screenContainer: {
    flex: 1,
    backgroundColor: theme.colors.bg.primary,
    padding: theme.spacing[3],
  },
  loadingText: {
    color: theme.colors.textHigh,
    fontFamily: theme.typography.fontFamily,
    ...theme.typography.h3,
    textAlign: 'center',
    marginTop: theme.spacing[5],
  },
  cardTitle: {
    color: theme.colors.textHigh,
    ...theme.typography.h2,
    marginBottom: theme.spacing[1],
  },
  cardText: {
    color: theme.colors.textMedium,
    ...theme.typography.body2,
  },
  sectionTitle: {
    color: theme.colors.textHigh,
    ...theme.typography.h3,
    marginTop: theme.spacing[4],
    marginBottom: theme.spacing[2],
  },
  emptyText: {
    color: theme.colors.textMedium,
    ...theme.typography.body2,
    textAlign: 'center',
    marginTop: theme.spacing[2],
  },
});

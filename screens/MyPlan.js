import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { supabase } from '../lib/supabase';
import { ModeCard, ModeListItem, ModeButton, HeaderBar } from '../lib/components';
import { theme } from '../lib/theme';

export default function MyPlan({ navigation }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const { data: user } = await supabase.auth.getUser();
        if (!user.user) {
          throw new Error('User not authenticated');
        }
        const { data, error } = await supabase.from('profiles').select('*').eq('id', user.user.id).single();
        if (error || !data) throw error || new Error('Profile missing');
        setProfile(data);
      } catch (err) {
        Alert.alert('Error', err.message);
      } finally {
        setLoading(false);
      }
    };
    loadProfile();
  }, []);

  if (loading) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>Loading my plan…</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.screenContainer} contentContainerStyle={styles.contentContainer}>
      <HeaderBar title="My Plan" subtitle="Your progress and settings" />
      <ModeCard>
        <Text style={styles.title}>Profile</Text>
        <Text style={styles.meta}>Fitness level: {profile?.fitness_level || 'N/A'}</Text>
        <Text style={styles.meta}>Goals: {(profile?.goals || []).join(', ') || 'N/A'}</Text>
        <Text style={styles.meta}>Equipment: {(profile?.equipment || []).join(', ') || 'N/A'}</Text>
      </ModeCard>
      <ModeCard>
        <Text style={styles.title}>Current plan</Text>
        <ModeListItem title="Duration" subtitle={`${profile?.duration || 30} min`} />
        <ModeListItem title="Workout type" subtitle={profile?.workout_type || 'Full body'} />
      </ModeCard>
      <ModeCard>
        <Text style={styles.title}>Metrics</Text>
        <ModeListItem title="Consistency" subtitle={`${profile?.consistency || 0}%`} />
        <ModeListItem title="Last session" subtitle={profile?.last_session || '—'} />
      </ModeCard>
      <ModeButton title="Edit my plan" variant="secondary" onPress={() => navigation.navigate('Home')} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screenContainer: {
    flex: 1,
    backgroundColor: theme.colors.bg.primary,
  },
  contentContainer: {
    padding: theme.spacing[3],
  },
  container: {
    flex: 1,
    backgroundColor: theme.colors.bg.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: theme.colors.textHigh,
    ...theme.typography.body1,
  },
  title: {
    color: theme.colors.textHigh,
    ...theme.typography.h3,
    marginBottom: theme.spacing[1],
  },
  meta: {
    color: theme.colors.textMedium,
    ...theme.typography.body2,
    marginBottom: theme.spacing[0],
  },
});
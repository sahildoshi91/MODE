import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { ModeButton, HeaderBar } from '../lib/components';
import { theme } from '../lib/theme';
import { supabase } from '../lib/supabase';

const durationOptions = [30, 45, 60];
const typeOptions = ['Full body', 'Upper/Lower split', 'Push/Pull/Legs', 'Cardio focused'];

export default function OnboardingPreferences({ navigation, route }) {
  const { fitness_level, goals, injuries, equipment } = route.params;
  const [duration, setDuration] = useState(30);
  const [workoutType, setWorkoutType] = useState('Full body');

  const finish = async () => {
    try {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) {
        Alert.alert('Error', 'User not authenticated');
        return;
      }
      const profile = {
        id: user.user.id,
        fitness_level,
        goals,
        injuries,
        equipment,
        duration,
        workout_type: workoutType,
      };
      await supabase.from('profiles').upsert(profile);
      navigation.navigate('Home');
    } catch (error) {
      Alert.alert('Error', error.message);
    }
  };

  return (
    <View style={styles.screenContainer}>
      <HeaderBar title="Onboarding 5 of 5" subtitle="Choose your session parameters" />

      <Text style={styles.title}>Almost there—your first plan is ready.</Text>

      <Text style={styles.sectionLabel}>Preferred workout duration (minutes):</Text>
      {durationOptions.map((d) => (
        <ModeButton
          key={d}
          title={`${d} min`}
          variant={duration === d ? 'primary' : 'secondary'}
          onPress={() => setDuration(d)}
          style={styles.optionButton}
        />
      ))}

      <Text style={[styles.sectionLabel, { marginTop: theme.spacing[3] }]}>Preferred workout type:</Text>
      {typeOptions.map((t) => (
        <ModeButton
          key={t}
          title={t}
          variant={workoutType === t ? 'primary' : 'secondary'}
          onPress={() => setWorkoutType(t)}
          style={styles.optionButton}
        />
      ))}

      <ModeButton title="Finish and get my plan" onPress={finish} style={styles.finishButton} />
    </View>
  );
}

const styles = StyleSheet.create({
  screenContainer: {
    flex: 1,
    backgroundColor: theme.colors.bg.primary,
    padding: theme.spacing[3],
  },
  title: {
    color: theme.colors.textHigh,
    ...theme.typography.h3,
    marginBottom: theme.spacing[2],
  },
  sectionLabel: {
    color: theme.colors.textMedium,
    ...theme.typography.body2,
    marginBottom: theme.spacing[1],
  },
  optionButton: {
    marginBottom: theme.spacing[1],
  },
  finishButton: {
    marginTop: theme.spacing[4],
  },
});
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
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
      };
      await supabase.from('profiles').insert(profile);
      navigation.navigate('Home');
    } catch (error) {
      Alert.alert('Error', error.message);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Preferred workout duration (minutes):</Text>
      {durationOptions.map(d => (
        <TouchableOpacity key={d} style={[styles.option, duration === d && styles.selected]} onPress={() => setDuration(d)}>
          <Text>{d}</Text>
        </TouchableOpacity>
      ))}
      <Text style={styles.title}>Preferred workout type:</Text>
      {typeOptions.map(t => (
        <TouchableOpacity key={t} style={[styles.option, workoutType === t && styles.selected]} onPress={() => setWorkoutType(t)}>
          <Text>{t}</Text>
        </TouchableOpacity>
      ))}
      <TouchableOpacity style={styles.nextButton} onPress={finish}>
        <Text style={styles.buttonText}>Finish Onboarding</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20 },
  title: { fontSize: 20, marginBottom: 10, marginTop: 20 },
  option: { padding: 15, borderWidth: 1, marginVertical: 5, borderRadius: 5 },
  selected: { backgroundColor: 'lightblue' },
  nextButton: { backgroundColor: 'blue', padding: 15, alignItems: 'center', marginTop: 20, borderRadius: 5 },
  buttonText: { color: 'white', fontSize: 16 },
});
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { supabase } from '../lib/supabase';

export default function Home({ navigation }) {
  const generateWorkout = async () => {
    try {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) {
        Alert.alert('Error', 'User not authenticated');
        return;
      }
      // For now, hardcode duration and type - TODO: get from preferences
      const response = await fetch('http://localhost:8000/generate-workout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user.user.id,
          duration: 30,
          workout_type: 'Full body'
        })
      });
      const data = await response.json();
      if (data.error) {
        Alert.alert('Error', data.error);
        return;
      }
      navigation.navigate('WorkoutDisplay', { workout: data.workout, planId: data.plan_id });
    } catch (error) {
      Alert.alert('Error', error.message);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome to MODE!</Text>
      <Text>Your personal trainer in your pocket.</Text>
      <TouchableOpacity style={styles.button} onPress={generateWorkout}>
        <Text style={styles.buttonText}>Generate Workout</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 24, marginBottom: 10 },
  button: { backgroundColor: 'blue', padding: 15, borderRadius: 5, marginTop: 20 },
  buttonText: { color: 'white', fontSize: 16 },
});
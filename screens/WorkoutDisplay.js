import React from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';

export default function WorkoutDisplay({ route }) {
  const { workout } = route.params;

  const renderExercise = ({ item }) => (
    <View style={styles.exercise}>
      <Text style={styles.name}>{item.name}</Text>
      <Text>Sets: {item.sets}, Reps: {item.reps}</Text>
      <Text>Rest: {item.rest_seconds}s</Text>
      <Text>Cue: {item.coaching_cue}</Text>
      <Text>Muscle: {item.muscle_group}</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Your Workout</Text>
      <FlatList
        data={workout.exercises}
        keyExtractor={(item, index) => index.toString()}
        renderItem={renderExercise}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20 },
  title: { fontSize: 24, marginBottom: 20, textAlign: 'center' },
  exercise: { marginVertical: 10, padding: 15, borderWidth: 1, borderRadius: 5, backgroundColor: '#f9f9f9' },
  name: { fontSize: 18, fontWeight: 'bold', marginBottom: 5 },
});
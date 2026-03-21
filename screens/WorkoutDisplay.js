import React from 'react';
import { View, Text, FlatList, StyleSheet, Alert } from 'react-native';
import { ModeCard, ModeListItem, ModeButton, HeaderBar } from '../lib/components';
import { theme } from '../lib/theme';
import { supabase } from '../lib/supabase';

export default function WorkoutDisplay({ route }) {
  const { workout, planId } = route.params || {};
  const exercises = workout?.exercises || [];

  const markComplete = async () => {
    try {
      await supabase.from('workouts').update({ completed: true }).eq('plan_id', planId);
      Alert.alert('Success', 'Workout marked as complete!');
    } catch (error) {
      Alert.alert('Error', error.message);
    }
  };

  const renderExercise = ({ item, index }) => (
    <ModeCard style={styles.exerciseCard} testID={`exercise-${index}`}>
      <Text style={styles.exerciseName}>{item.name}</Text>
      <Text style={styles.exerciseMeta}>Sets: {item.sets} • Reps: {item.reps}</Text>
      <Text style={styles.exerciseMeta}>Rest: {item.rest_seconds}s</Text>
      <Text style={styles.exerciseMeta}>Cue: {item.coaching_cue}</Text>
      <Text style={styles.exerciseMeta}>Target: {item.muscle_group}</Text>
    </ModeCard>
  );

  return (
    <View style={styles.screenContainer}>
      <HeaderBar title="Workout Plan" subtitle="Your AI coaching sequence" />
      <ModeCard style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>{workout?.title || 'Daily Focus Session'}</Text>
        <Text style={styles.summaryText}>{workout?.description || 'Balance, strength, and mobility in one session.'}</Text>
      </ModeCard>

      <Text style={styles.sectionTitle}>Exercises</Text>
      <FlatList
        data={exercises}
        keyExtractor={(item, index) => item.id?.toString() || `${index}`}
        renderItem={renderExercise}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<Text style={styles.emptyText}>No exercises found. Generate a workout from Home.</Text>}
      />

      <ModeButton title="Mark Complete" variant="secondary" onPress={markComplete} style={styles.completeButton} />
    </View>
  );
}

const styles = StyleSheet.create({
  screenContainer: {
    flex: 1,
    backgroundColor: theme.colors.bg.primary,
    padding: theme.spacing[3],
  },
  summaryCard: {
    marginTop: theme.spacing[2],
    marginBottom: theme.spacing[3],
  },
  summaryTitle: {
    color: theme.colors.textHigh,
    ...theme.typography.h3,
    marginBottom: theme.spacing[1],
  },
  summaryText: {
    color: theme.colors.textMedium,
    ...theme.typography.body2,
  },
  sectionTitle: {
    color: theme.colors.textHigh,
    ...theme.typography.h3,
    marginBottom: theme.spacing[2],
  },
  listContent: {
    paddingBottom: theme.spacing[5],
  },
  exerciseCard: {
    marginBottom: theme.spacing[1],
  },
  exerciseName: {
    color: theme.colors.accent,
    ...theme.typography.h3,
    marginBottom: theme.spacing[1],
  },
  exerciseMeta: {
    color: theme.colors.textMedium,
    ...theme.typography.body2,
  },
  emptyText: {
    color: theme.colors.textMedium,
    ...theme.typography.body2,
    textAlign: 'center',
    marginTop: theme.spacing[3],
  },
  completeButton: {
    marginTop: theme.spacing[3],
  },
});
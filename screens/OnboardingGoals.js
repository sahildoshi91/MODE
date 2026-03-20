import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList } from 'react-native';

const goalsOptions = ['Lose weight', 'Build muscle', 'Improve endurance', 'Increase strength', 'General fitness'];

export default function OnboardingGoals({ navigation, route }) {
  const { fitness_level } = route.params;
  const [selectedGoals, setSelectedGoals] = useState([]);

  const toggleGoal = (goal) => {
    if (selectedGoals.includes(goal)) {
      setSelectedGoals(selectedGoals.filter(g => g !== goal));
    } else {
      setSelectedGoals([...selectedGoals, goal]);
    }
  };

  const next = () => {
    navigation.navigate('OnboardingInjuries', { fitness_level, goals: selectedGoals });
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>What are your goals? (Select all that apply)</Text>
      <FlatList
        data={goalsOptions}
        keyExtractor={(item) => item}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.option, selectedGoals.includes(item) && styles.selected]}
            onPress={() => toggleGoal(item)}
          >
            <Text>{item}</Text>
          </TouchableOpacity>
        )}
      />
      <TouchableOpacity style={styles.nextButton} onPress={next} disabled={selectedGoals.length === 0}>
        <Text>Next</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20 },
  title: { fontSize: 24, marginBottom: 20, textAlign: 'center' },
  option: { padding: 15, borderWidth: 1, marginVertical: 5, borderRadius: 5 },
  selected: { backgroundColor: 'lightblue' },
  nextButton: { backgroundColor: 'blue', padding: 15, alignItems: 'center', marginTop: 20, borderRadius: 5 },
});
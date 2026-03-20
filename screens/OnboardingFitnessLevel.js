import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

export default function OnboardingFitnessLevel({ navigation }) {
  const selectLevel = (level) => {
    navigation.navigate('OnboardingGoals', { fitness_level: level });
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>What is your fitness level?</Text>
      <TouchableOpacity style={styles.button} onPress={() => selectLevel('beginner')}>
        <Text>Beginner</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.button} onPress={() => selectLevel('intermediate')}>
        <Text>Intermediate</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.button} onPress={() => selectLevel('advanced')}>
        <Text>Advanced</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  title: { fontSize: 24, marginBottom: 20, textAlign: 'center' },
  button: { backgroundColor: '#ddd', padding: 15, marginVertical: 10, width: '80%', alignItems: 'center', borderRadius: 5 },
});
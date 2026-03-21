import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList } from 'react-native';
import { ModeButton, ModeCard, HeaderBar } from '../lib/components';
import { theme } from '../lib/theme';

const goalsOptions = ['Lose weight', 'Build muscle', 'Improve endurance', 'Increase strength', 'General fitness'];

export default function OnboardingGoals({ navigation, route }) {
  const { fitness_level } = route.params;
  const [selectedGoals, setSelectedGoals] = useState([]);

  const toggleGoal = (goal) => {
    setSelectedGoals((prev) =>
      prev.includes(goal) ? prev.filter((g) => g !== goal) : [...prev, goal],
    );
  };

  const next = () => {
    navigation.navigate('OnboardingInjuries', { fitness_level, goals: selectedGoals });
  };

  return (
    <View style={styles.screenContainer}>
      <HeaderBar title="Onboarding 2 of 5" subtitle="Choose your main goals" />
      <ModeCard>
        <Text style={styles.title}>Awesome—what are you training for?</Text>
        <Text style={styles.subtitle}>Pick one or two goals to keep this plan focused.</Text>
      </ModeCard>

      <FlatList
        data={goalsOptions}
        keyExtractor={(item) => item}
        renderItem={({ item }) => (
          <ModeButton
            style={[styles.goalOption, selectedGoals.includes(item) && styles.goalSelected]}
            variant={selectedGoals.includes(item) ? 'primary' : 'secondary'}
            title={item}
            onPress={() => toggleGoal(item)}
          />
        )}
      />

      <ModeButton
        title={selectedGoals.length === 0 ? 'Choose one to continue' : 'Yes, let’s do this'}
        onPress={next}
        disabled={selectedGoals.length === 0}
        style={styles.nextButton}
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
  title: {
    color: theme.colors.textHigh,
    ...theme.typography.h3,
    marginBottom: theme.spacing[1],
  },
  subtitle: {
    color: theme.colors.textMedium,
    ...theme.typography.body2,
  },
  goalOption: {
    marginBottom: theme.spacing[1],
  },
  goalSelected: {
    borderColor: theme.colors.accent,
  },
  nextButton: {
    marginTop: theme.spacing[3],
  },
});
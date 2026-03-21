import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ModeButton, ModeCard, HeaderBar } from '../lib/components';
import { theme } from '../lib/theme';

const options = ['Beginner', 'Intermediate', 'Advanced'];

export default function OnboardingFitnessLevel({ navigation }) {
  const selectLevel = (level) => {
    navigation.navigate('OnboardingGoals', { fitness_level: level.toLowerCase() });
  };

  return (
    <View style={styles.screenContainer}>
      <HeaderBar title="Onboarding 1 of 5" subtitle="Tell us your fitness level" />
      <ModeCard>
        <Text style={styles.title}>Great start! Where are you today?</Text>
        <Text style={styles.subtitle}>This helps MODE choose the right intensity and progression.</Text>
      </ModeCard>
      {options.map((text) => (
        <ModeButton
          key={text}
          title={text}
          variant="secondary"
          onPress={() => selectLevel(text)}
          style={styles.optionButton}
        />
      ))}
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
  optionButton: {
    marginTop: theme.spacing[2],
  },
});
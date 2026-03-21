import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList } from 'react-native';
import { ModeButton, HeaderBar } from '../lib/components';
import { theme } from '../lib/theme';

const equipmentOptions = ['Dumbbells', 'Barbell', 'Resistance bands', 'Kettlebell', 'Bodyweight only', 'Bench', 'Pull-up bar'];

export default function OnboardingEquipment({ navigation, route }) {
  const { fitness_level, goals, injuries } = route.params;
  const [selectedEquipment, setSelectedEquipment] = useState([]);

  const toggleEquipment = (eq) => {
    setSelectedEquipment((prev) => (prev.includes(eq) ? prev.filter((e) => e !== eq) : [...prev, eq]));
  };

  const next = () => {
    navigation.navigate('OnboardingPreferences', { fitness_level, goals, injuries, equipment: selectedEquipment });
  };

  return (
    <View style={styles.screenContainer}>
      <HeaderBar title="Onboarding 4 of 5" subtitle="What equipment do you have?" />

      <Text style={styles.title}>Ready to work with your gear.</Text>
      <Text style={styles.subtitle}>Choose what’s available so your plan is realistic.</Text>

      <FlatList
        data={equipmentOptions}
        keyExtractor={(item) => item}
        renderItem={({ item }) => (
          <ModeButton
            variant={selectedEquipment.includes(item) ? 'primary' : 'secondary'}
            title={item}
            onPress={() => toggleEquipment(item)}
            style={styles.optionButton}
          />
        )}
      />

      <ModeButton
        title={selectedEquipment.length === 0 ? 'Choose one to continue' : 'Perfect, keep going'}
        onPress={next}
        disabled={selectedEquipment.length === 0}
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
    marginTop: theme.spacing[3],
  },
  subtitle: {
    color: theme.colors.textMedium,
    ...theme.typography.body2,
    marginBottom: theme.spacing[3],
  },
  optionButton: {
    marginBottom: theme.spacing[1],
  },
  nextButton: {
    marginTop: theme.spacing[3],
  },
});
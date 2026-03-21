import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ModeInput, ModeButton, ModeCard, HeaderBar } from '../lib/components';
import { theme } from '../lib/theme';

export default function OnboardingInjuries({ navigation, route }) {
  const { fitness_level, goals } = route.params;
  const [injuries, setInjuries] = useState('');

  const next = () => {
    const injuriesArray = injuries
      ? injuries.split(',').map((i) => i.trim()).filter((i) => i)
      : [];
    navigation.navigate('OnboardingEquipment', { fitness_level, goals, injuries: injuriesArray });
  };

  return (
    <View style={styles.screenContainer}>
      <HeaderBar title="Onboarding 3 of 5" subtitle="Tell us about injuries" />
      <ModeCard>
        <Text style={styles.title}>We’ve got your back (and joints).</Text>
        <Text style={styles.subtitle}>Let us know if anything needs special attention.</Text>
      </ModeCard>

      <ModeInput
        placeholder="e.g. knee pain, back injury"
        value={injuries}
        onChangeText={setInjuries}
      />
      <ModeButton title="Next" onPress={next} style={styles.nextButton} />
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
  nextButton: {
    marginTop: theme.spacing[3],
  },
});
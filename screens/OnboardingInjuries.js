import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';

export default function OnboardingInjuries({ navigation, route }) {
  const { fitness_level, goals } = route.params;
  const [injuries, setInjuries] = useState('');

  const next = () => {
    const injuriesArray = injuries ? injuries.split(',').map(i => i.trim()).filter(i => i) : [];
    navigation.navigate('OnboardingEquipment', { fitness_level, goals, injuries: injuriesArray });
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Do you have any injuries or conditions we should know about? (comma separated)</Text>
      <TextInput
        style={styles.input}
        value={injuries}
        onChangeText={setInjuries}
        placeholder="e.g. knee pain, back injury"
      />
      <TouchableOpacity style={styles.nextButton} onPress={next}>
        <Text>Next</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, justifyContent: 'center' },
  title: { fontSize: 24, marginBottom: 20, textAlign: 'center' },
  input: { borderWidth: 1, padding: 15, marginVertical: 20, borderRadius: 5 },
  nextButton: { backgroundColor: 'blue', padding: 15, alignItems: 'center', borderRadius: 5 },
});
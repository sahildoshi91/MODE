import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList } from 'react-native';

const equipmentOptions = ['Dumbbells', 'Barbell', 'Resistance bands', 'Kettlebell', 'Bodyweight only', 'Bench', 'Pull-up bar'];

export default function OnboardingEquipment({ navigation, route }) {
  const { fitness_level, goals, injuries } = route.params;
  const [selectedEquipment, setSelectedEquipment] = useState([]);

  const toggleEquipment = (eq) => {
    if (selectedEquipment.includes(eq)) {
      setSelectedEquipment(selectedEquipment.filter(e => e !== eq));
    } else {
      setSelectedEquipment([...selectedEquipment, eq]);
    }
  };

  const next = () => {
    navigation.navigate('OnboardingPreferences', { fitness_level, goals, injuries, equipment: selectedEquipment });
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>What equipment do you have access to? (Select all that apply)</Text>
      <FlatList
        data={equipmentOptions}
        keyExtractor={(item) => item}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.option, selectedEquipment.includes(item) && styles.selected]}
            onPress={() => toggleEquipment(item)}
          >
            <Text>{item}</Text>
          </TouchableOpacity>
        )}
      />
      <TouchableOpacity style={styles.nextButton} onPress={next} disabled={selectedEquipment.length === 0}>
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
import * as React from 'react';
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { supabase } from './lib/supabase';
import Login from './screens/Login';
import OnboardingFitnessLevel from './screens/OnboardingFitnessLevel';
import OnboardingGoals from './screens/OnboardingGoals';
import OnboardingInjuries from './screens/OnboardingInjuries';
import OnboardingEquipment from './screens/OnboardingEquipment';
import OnboardingPreferences from './screens/OnboardingPreferences';
import Home from './screens/Home';
import WorkoutDisplay from './screens/WorkoutDisplay';

const Stack = createNativeStackNavigator();

export default function App() {
  const [user, setUser] = useState(null);
  const [hasProfile, setHasProfile] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const getInitialSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setUser(session?.user ?? null);
      if (session?.user) {
        await checkProfile(session.user.id);
      }
      setLoading(false);
    };

    getInitialSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        await checkProfile(session.user.id);
      } else {
        setHasProfile(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const checkProfile = async (userId) => {
    try {
      const { data } = await supabase.from('profiles').select('*').eq('id', userId).single();
      setHasProfile(!!data);
    } catch (error) {
      setHasProfile(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loading}>
        <Text>Loading...</Text>
      </View>
    );
  }

  if (!user) {
    return (
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen name="Login" component={Login} options={{ headerShown: false }} />
        </Stack.Navigator>
      </NavigationContainer>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName={hasProfile ? 'Home' : 'OnboardingFitnessLevel'}>
        <Stack.Screen name="OnboardingFitnessLevel" component={OnboardingFitnessLevel} />
        <Stack.Screen name="OnboardingGoals" component={OnboardingGoals} />
        <Stack.Screen name="OnboardingInjuries" component={OnboardingInjuries} />
        <Stack.Screen name="OnboardingEquipment" component={OnboardingEquipment} />
        <Stack.Screen name="OnboardingPreferences" component={OnboardingPreferences} />
        <Stack.Screen name="Home" component={Home} />
        <Stack.Screen name="WorkoutDisplay" component={WorkoutDisplay} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
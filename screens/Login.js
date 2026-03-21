import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { supabase } from '../lib/supabase';
import { ModeInput, ModeButton, HeaderBar } from '../lib/components';
import { theme } from '../lib/theme';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignup, setIsSignup] = useState(false);

  const handleAuth = async () => {
    try {
      if (isSignup) {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        Alert.alert('Success', 'Check your email for confirmation');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (error) {
      Alert.alert('Error', error.message);
    }
  };

  return (
    <View style={styles.screenContainer}>
      <HeaderBar title="MODE Workout" subtitle="Secure AI workouts, no fluff" />
      <View style={styles.stack}>
        <Text style={styles.title}>{isSignup ? 'Create your account' : 'Welcome back'}</Text>
        <ModeInput
          testID="email-input"
          placeholder="Email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
        />
        <ModeInput
          testID="password-input"
          placeholder="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />
        <ModeButton
          testID="action-button"
          title={isSignup ? 'Sign Up' : 'Login'}
          onPress={handleAuth}
        />
        <ModeButton
          testID="switch-auth"
          variant="secondary"
          title={isSignup ? 'Have an account? Login' : 'New? Sign Up'}
          onPress={() => setIsSignup(!isSignup)}
          style={styles.switchButton}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screenContainer: {
    flex: 1,
    backgroundColor: theme.colors.bg.primary,
    padding: theme.spacing[3],
  },
  stack: {
    marginTop: theme.spacing[4],
    gap: theme.spacing[2],
  },
  title: {
    color: theme.colors.textHigh,
    ...theme.typography.h2,
    marginBottom: theme.spacing[2],
  },
  switchButton: {
    marginTop: theme.spacing[1],
    shadowColor: 'transparent',
    elevation: 0,
  },
});
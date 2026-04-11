import React, { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { HeaderBar, ModeButton, ModeInput, ModeText, SafeScreen } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import { supabase } from '../../../services/supabaseClient';

export default function Login({ onBackToIntro = null }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignup, setIsSignup] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleAuth = async () => {
    if (isSubmitting) {
      return;
    }

    try {
      setIsSubmitting(true);
      if (isSignup) {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        Alert.alert('Success', 'Check your email for confirmation.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (error) {
      Alert.alert('Error', error?.message || 'Unable to sign in right now.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeScreen includeTopInset={false} style={styles.screenContainer}>
      <HeaderBar title="MODE" subtitle="Calm coaching for sustainable progress" />

      <View style={styles.stack}>
        <ModeText variant="h2">{isSignup ? 'Create your account' : 'Welcome back'}</ModeText>
        <ModeText variant="bodySm" tone="secondary" style={styles.supportText}>
          {isSignup
            ? 'Set up your account to start personalized coaching.'
            : 'Sign in to continue with your coach and daily plan.'}
        </ModeText>

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
          size="lg"
          title={isSubmitting ? 'Please wait...' : isSignup ? 'Create account' : 'Sign in'}
          onPress={handleAuth}
          disabled={isSubmitting}
          style={styles.primaryButton}
        />

        <ModeButton
          testID="switch-auth"
          variant="secondary"
          title={isSignup ? 'Have an account? Sign in' : 'New here? Create account'}
          onPress={() => setIsSignup((current) => !current)}
          disabled={isSubmitting}
        />

        {typeof onBackToIntro === 'function' ? (
          <ModeButton
            variant="ghost"
            title="Back to intro"
            onPress={onBackToIntro}
            disabled={isSubmitting}
            style={styles.backButton}
          />
        ) : null}
      </View>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  screenContainer: {
    paddingHorizontal: theme.spacing[3],
    backgroundColor: theme.colors.surface.canvas,
  },
  stack: {
    marginTop: theme.spacing[4],
    gap: theme.spacing[2],
  },
  supportText: {
    marginBottom: theme.spacing[1],
  },
  primaryButton: {
    marginTop: theme.spacing[1],
  },
  backButton: {
    marginTop: theme.spacing[1],
  },
});

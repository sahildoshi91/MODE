import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';

import { SafeScreen } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import { getApiDebugInfo } from '../../../services/apiBaseUrl';

function valueOrFallback(value, fallback = 'Not available') {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  return fallback;
}

export default function ProfileScreen({ session, assignmentStatus, onSignOut, bottomInset = 0 }) {
  const debugInfo = useMemo(() => getApiDebugInfo(), []);
  const email = valueOrFallback(session?.user?.email, 'No email found');
  const trainerName = valueOrFallback(assignmentStatus?.assigned_trainer_display_name, 'No trainer assigned');
  const appVersion = valueOrFallback(Constants.expoConfig?.version, 'dev');
  const environment = __DEV__ ? 'Development' : 'Production';

  return (
    <SafeScreen style={styles.screen}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: theme.spacing[4] + bottomInset },
        ]}
      >
        <View style={styles.headerBlock}>
          <Text style={styles.title}>Profile</Text>
          <Text style={styles.subtitle}>Account and app details</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Account</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Email</Text>
            <Text style={styles.rowValue}>{email}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Coach</Text>
            <Text style={styles.rowValue}>{trainerName}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Diagnostics</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Environment</Text>
            <Text style={styles.rowValue}>{environment}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Version</Text>
            <Text style={styles.rowValue}>{appVersion}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.rowLabel}>API Base</Text>
            <Text style={styles.rowValue}>{valueOrFallback(debugInfo.resolvedApiBaseUrl)}</Text>
          </View>
        </View>

        <View style={styles.signOutWrap}>
          <Pressable
            onPress={onSignOut}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.signOutButton,
              pressed && styles.signOutButtonPressed,
            ]}
          >
            <Text style={styles.signOutText}>Sign Out</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: '#F2F4F7',
  },
  content: {
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[4],
    gap: theme.spacing[2],
  },
  headerBlock: {
    marginBottom: theme.spacing[1],
  },
  title: {
    color: '#0F1115',
    fontFamily: theme.typography.fontFamily,
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  subtitle: {
    marginTop: theme.spacing[1],
    color: 'rgba(15, 17, 21, 0.66)',
    fontFamily: theme.typography.fontFamily,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '400',
  },
  card: {
    borderRadius: 22,
    padding: theme.spacing[3],
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.56)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 18,
    elevation: 4,
  },
  cardTitle: {
    color: 'rgba(15, 17, 21, 0.72)',
    fontFamily: theme.typography.fontFamily,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: theme.spacing[2],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[2],
  },
  rowLabel: {
    flexShrink: 0,
    color: 'rgba(15, 17, 21, 0.58)',
    fontFamily: theme.typography.fontFamily,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '500',
  },
  rowValue: {
    flex: 1,
    textAlign: 'right',
    color: '#0F1115',
    fontFamily: theme.typography.fontFamily,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '500',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(15, 17, 21, 0.08)',
    marginVertical: theme.spacing[2],
  },
  signOutWrap: {
    marginTop: theme.spacing[1],
  },
  signOutButton: {
    borderRadius: 18,
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.68)',
    borderWidth: 1,
    borderColor: 'rgba(15, 17, 21, 0.12)',
    shadowOpacity: 0,
  },
  signOutButtonPressed: {
    transform: [{ scale: 0.98 }],
    opacity: 0.92,
  },
  signOutText: {
    color: '#0F1115',
    fontFamily: theme.typography.fontFamily,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '600',
  },
});

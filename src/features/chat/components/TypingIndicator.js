import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { theme } from '../../../../lib/theme';

export default function TypingIndicator() {
  return (
    <View style={styles.wrap}>
      <View style={styles.coachRail} />
      <Text style={styles.text}>Coach is thinking…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: 'flex-start',
    backgroundColor: '#EAF3EE',
    borderRadius: theme.radii.l,
    borderWidth: 1,
    borderColor: 'rgba(111, 143, 123, 0.4)',
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    marginBottom: theme.spacing[2],
    position: 'relative',
  },
  coachRail: {
    position: 'absolute',
    left: 8,
    top: 8,
    bottom: 8,
    width: 3,
    borderRadius: 2,
    backgroundColor: theme.colors.brand.progressCore,
  },
  text: {
    color: theme.colors.text.secondary,
    ...theme.typography.body2,
    fontFamily: theme.typography.fontFamily,
  },
});

import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ModeText } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';

export function MetricExplainer({ description }) {
  if (!description) {
    return null;
  }

  return (
    <View style={styles.container}>
      <ModeText variant="label" tone="tertiary">
        What this measures
      </ModeText>
      <ModeText variant="body2" tone="secondary" style={styles.body}>
        {description}
      </ModeText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 4,
    paddingTop: theme.spacing[2],
    borderTopWidth: 1,
    borderTopColor: theme.colors.glass.borderSoft,
  },
  body: {},
});

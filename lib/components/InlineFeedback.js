import React from 'react';
import { StyleSheet, View } from 'react-native';

import { theme } from '../theme';
import { ModeText } from './ModeText';

const FEEDBACK_STYLES = {
  success: {
    backgroundColor: 'rgba(76, 175, 125, 0.14)',
    borderColor: 'rgba(76, 175, 125, 0.4)',
    tone: 'success',
  },
  warning: {
    backgroundColor: 'rgba(212, 175, 127, 0.18)',
    borderColor: 'rgba(212, 175, 127, 0.48)',
    tone: 'warning',
  },
  error: {
    backgroundColor: 'rgba(196, 138, 138, 0.16)',
    borderColor: 'rgba(196, 138, 138, 0.45)',
    tone: 'error',
  },
  info: {
    backgroundColor: 'rgba(111, 143, 123, 0.13)',
    borderColor: 'rgba(111, 143, 123, 0.42)',
    tone: 'accent',
  },
};

export const InlineFeedback = ({ type = 'info', message, style, testID }) => {
  if (!message) {
    return null;
  }

  const visual = FEEDBACK_STYLES[type] || FEEDBACK_STYLES.info;

  return (
    <View
      testID={testID}
      style={[
        styles.container,
        {
          backgroundColor: visual.backgroundColor,
          borderColor: visual.borderColor,
        },
        style,
      ]}
    >
      <ModeText variant="bodySm" tone={visual.tone}>{message}</ModeText>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    borderRadius: theme.radii.s,
    borderWidth: 1,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
  },
});

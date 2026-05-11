import React from 'react';
import { StyleSheet } from 'react-native';

import { theme } from '../theme';
import { ModeText } from './ModeText';
import { GlassSurface } from './glass/GlassSurface';

const FEEDBACK_STYLES = {
  success: {
    backgroundColor: theme.colors.feedback.successBg,
    borderColor: theme.colors.feedback.successBorder,
    tone: 'success',
  },
  warning: {
    backgroundColor: theme.colors.feedback.warningBg,
    borderColor: theme.colors.feedback.warningBorder,
    tone: 'warning',
  },
  error: {
    backgroundColor: theme.colors.feedback.errorBg,
    borderColor: theme.colors.feedback.errorBorder,
    tone: 'error',
  },
  info: {
    backgroundColor: theme.colors.feedback.infoBg,
    borderColor: theme.colors.feedback.infoBorder,
    tone: 'info',
  },
};

export const InlineFeedback = ({ type = 'info', message, style, testID }) => {
  if (!message) {
    return null;
  }

  const visual = FEEDBACK_STYLES[type] || FEEDBACK_STYLES.info;

  return (
    <GlassSurface
      testID={testID}
      state="muted"
      style={[
        styles.container,
        {
          backgroundColor: visual.backgroundColor,
          borderColor: visual.borderColor,
        },
        style,
      ]}
      contentStyle={styles.content}
      fillColor={visual.backgroundColor}
      borderColor={visual.borderColor}
      highlight={false}
    >
      <ModeText variant="bodySm" tone={visual.tone}>{message}</ModeText>
    </GlassSurface>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  content: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
  },
});

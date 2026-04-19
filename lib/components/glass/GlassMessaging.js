import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { theme } from '../../theme';
import { GlassSurface } from './GlassSurface';

function BaseBubble({
  text,
  isError = false,
  showSpeakerLabel = true,
  speakerLabel,
  align = 'left',
  bubbleStyle,
  bubbleContentStyle,
  bubbleState = 'default',
  bubbleFillColor,
  bubbleBorderColor,
  labelTone = 'secondary',
}) {
  const isRight = align === 'right';

  return (
    <View style={[styles.row, isRight ? styles.rowRight : styles.rowLeft]}>
      {showSpeakerLabel ? (
        <Text
          style={[
            styles.speakerLabel,
            isRight && styles.speakerLabelRight,
            labelTone === 'muted' ? styles.speakerLabelMuted : null,
          ]}
        >
          {speakerLabel}
        </Text>
      ) : null}
      <GlassSurface
        state={isError ? 'muted' : bubbleState}
        radius={20}
        style={[
          styles.bubble,
          isRight ? styles.bubbleRight : styles.bubbleLeft,
          bubbleStyle,
          isError && styles.errorBubble,
        ]}
        contentStyle={[styles.bubbleContent, bubbleContentStyle]}
        fillColor={isError ? theme.colors.feedback.errorBg : bubbleFillColor}
        borderColor={isError ? theme.colors.feedback.errorBorder : bubbleBorderColor}
      >
        <Text style={[styles.text, isRight ? styles.textRight : styles.textLeft]}>
          {text}
        </Text>
      </GlassSurface>
    </View>
  );
}

export function ChatBubbleUser({
  text,
  showSpeakerLabel = true,
  speakerLabel = 'You',
  isError = false,
}) {
  return (
    <BaseBubble
      align="right"
      text={text}
      showSpeakerLabel={showSpeakerLabel}
      speakerLabel={speakerLabel}
      isError={isError}
      bubbleState="active"
      bubbleFillColor="rgba(120, 163, 242, 0.13)"
      bubbleBorderColor="rgba(130, 177, 255, 0.30)"
      labelTone="muted"
      bubbleContentStyle={styles.userBubbleContent}
    />
  );
}

export function ChatBubbleAI({
  text,
  showSpeakerLabel = true,
  speakerLabel = 'Coach',
  isError = false,
}) {
  return (
    <BaseBubble
      align="left"
      text={text}
      showSpeakerLabel={showSpeakerLabel}
      speakerLabel={speakerLabel}
      isError={isError}
      bubbleState="default"
      bubbleFillColor={theme.colors.glass.elevated}
      bubbleBorderColor={theme.colors.glass.borderDefault}
      labelTone="secondary"
      bubbleContentStyle={styles.aiBubbleContent}
    />
  );
}

const styles = StyleSheet.create({
  row: {
    width: '100%',
    marginBottom: theme.spacing[2],
    gap: 4,
  },
  rowLeft: {
    alignItems: 'flex-start',
  },
  rowRight: {
    alignItems: 'flex-end',
  },
  speakerLabel: {
    paddingHorizontal: theme.spacing[1],
    textTransform: 'uppercase',
    letterSpacing: 0.45,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.body3.fontSize,
    lineHeight: theme.typography.body3.lineHeight,
    fontWeight: '600',
    color: theme.colors.text.secondary,
  },
  speakerLabelRight: {
    textAlign: 'right',
  },
  speakerLabelMuted: {
    color: theme.colors.text.tertiary,
  },
  bubble: {
    maxWidth: '87%',
  },
  bubbleLeft: {
    alignSelf: 'flex-start',
  },
  bubbleRight: {
    alignSelf: 'flex-end',
  },
  bubbleContent: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1] + 2,
  },
  aiBubbleContent: {
    borderTopLeftRadius: 14,
  },
  userBubbleContent: {
    borderTopRightRadius: 14,
  },
  text: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.body1.fontSize,
    lineHeight: theme.typography.body1.lineHeight,
  },
  textLeft: {
    color: theme.colors.text.primary,
  },
  textRight: {
    color: theme.colors.text.primary,
  },
  errorBubble: {
    shadowColor: theme.colors.status.error,
    shadowOpacity: 0.15,
    shadowRadius: 10,
  },
});

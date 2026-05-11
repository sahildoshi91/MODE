import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { theme } from '../../theme';
import { GlassSurface } from './GlassSurface';

const GROUP_POSITION = {
  single: 'single',
  start: 'start',
  middle: 'middle',
  end: 'end',
};

function resolveGroupPosition(value) {
  if (value === GROUP_POSITION.start
    || value === GROUP_POSITION.middle
    || value === GROUP_POSITION.end
  ) {
    return value;
  }
  return GROUP_POSITION.single;
}

function resolveGroupShapeStyle(isRight, groupPosition) {
  if (isRight) {
    if (groupPosition === GROUP_POSITION.start) {
      return styles.userGroupStart;
    }
    if (groupPosition === GROUP_POSITION.middle) {
      return styles.userGroupMiddle;
    }
    if (groupPosition === GROUP_POSITION.end) {
      return styles.userGroupEnd;
    }
    return styles.userGroupSingle;
  }
  if (groupPosition === GROUP_POSITION.start) {
    return styles.aiGroupStart;
  }
  if (groupPosition === GROUP_POSITION.middle) {
    return styles.aiGroupMiddle;
  }
  if (groupPosition === GROUP_POSITION.end) {
    return styles.aiGroupEnd;
  }
  return styles.aiGroupSingle;
}

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
  groupPosition = GROUP_POSITION.single,
  renderContent = null,
  onLongPress = null,
}) {
  const isRight = align === 'right';
  const resolvedGroupPosition = resolveGroupPosition(groupPosition);
  const groupedShapeStyle = resolveGroupShapeStyle(isRight, resolvedGroupPosition);
  const resolvedCustomContent = typeof renderContent === 'function'
    ? renderContent({ text, isError, align, groupPosition: resolvedGroupPosition })
    : renderContent;

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
        contentStyle={[styles.bubbleContent, groupedShapeStyle, bubbleContentStyle]}
        fillColor={isError ? theme.colors.feedback.errorBg : bubbleFillColor}
        borderColor={isError ? theme.colors.feedback.errorBorder : bubbleBorderColor}
        onLongPress={onLongPress}
      >
        {React.isValidElement(resolvedCustomContent) ? (
          <View style={styles.richContent}>
            {resolvedCustomContent}
          </View>
        ) : (
          <Text style={[styles.text, isRight ? styles.textRight : styles.textLeft]}>
            {text}
          </Text>
        )}
      </GlassSurface>
    </View>
  );
}

export function ChatBubbleUser({
  text,
  showSpeakerLabel = true,
  speakerLabel = 'You',
  isError = false,
  groupPosition = GROUP_POSITION.single,
  renderContent = null,
  onLongPress = null,
}) {
  return (
    <BaseBubble
      align="right"
      text={text}
      showSpeakerLabel={showSpeakerLabel}
      speakerLabel={speakerLabel}
      isError={isError}
      bubbleState="active"
      bubbleFillColor="rgba(95, 145, 236, 0.38)"
      bubbleBorderColor="rgba(152, 196, 255, 0.50)"
      labelTone="muted"
      bubbleStyle={styles.userBubble}
      groupPosition={groupPosition}
      renderContent={renderContent}
      onLongPress={onLongPress}
    />
  );
}

export function ChatBubbleAI({
  text,
  showSpeakerLabel = true,
  speakerLabel = 'Coach',
  isError = false,
  groupPosition = GROUP_POSITION.single,
  renderContent = null,
  onLongPress = null,
  wide = false,
}) {
  return (
    <BaseBubble
      align="left"
      text={text}
      showSpeakerLabel={showSpeakerLabel}
      speakerLabel={speakerLabel}
      isError={isError}
      bubbleState="default"
      bubbleFillColor="rgba(14, 25, 44, 0.64)"
      bubbleBorderColor="rgba(214, 230, 255, 0.28)"
      labelTone="secondary"
      bubbleStyle={[styles.aiBubble, wide && styles.aiBubbleWide]}
      bubbleContentStyle={wide && styles.aiBubbleWideContent}
      groupPosition={groupPosition}
      renderContent={renderContent}
      onLongPress={onLongPress}
    />
  );
}

const styles = StyleSheet.create({
  row: {
    width: '100%',
    marginBottom: 0,
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
    maxWidth: '74%',
  },
  bubbleLeft: {
    alignSelf: 'flex-start',
  },
  bubbleRight: {
    alignSelf: 'flex-end',
  },
  bubbleContent: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  aiGroupSingle: {
    borderTopLeftRadius: 14,
    borderTopRightRadius: 18,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
  },
  aiGroupStart: {
    borderTopLeftRadius: 14,
    borderTopRightRadius: 18,
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 16,
  },
  aiGroupMiddle: {
    borderTopLeftRadius: 10,
    borderTopRightRadius: 16,
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 16,
  },
  aiGroupEnd: {
    borderTopLeftRadius: 10,
    borderTopRightRadius: 16,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
  },
  userGroupSingle: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 14,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
  },
  userGroupStart: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 14,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 10,
  },
  userGroupMiddle: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 10,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 10,
  },
  userGroupEnd: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 10,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
  },
  aiBubble: {
    shadowColor: '#020B18',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  aiBubbleWide: {
    maxWidth: '94%',
  },
  aiBubbleWideContent: {
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  userBubble: {
    shadowColor: 'rgba(94, 146, 236, 1)',
    shadowOpacity: 0.16,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  text: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.body1.fontSize,
    lineHeight: theme.typography.body1.lineHeight,
  },
  textLeft: {
    color: 'rgba(255, 255, 255, 0.94)',
  },
  textRight: {
    color: 'rgba(255, 255, 255, 0.95)',
  },
  richContent: {
    width: '100%',
  },
  errorBubble: {
    shadowColor: theme.colors.status.error,
    shadowOpacity: 0.15,
    shadowRadius: 10,
  },
});

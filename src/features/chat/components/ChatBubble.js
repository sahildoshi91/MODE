import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ModeText } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import { ChatBubbleAI, ChatBubbleUser } from '../../../../lib/components/glass';
import { AI_RESPONSE_RENDERING_V1_ENABLED } from '../../../config/featureFlags';
import AIResponseRenderer from './AIResponseRenderer';
import { parseAIResponseText, sanitizeAssistantDisplayText } from '../utils/aiResponseParser';

const OPENING_LABEL_PATTERN = /^(Training|Nutrition|Mindset):\s*(.*)$/i;
const OPENING_QUESTION_PATTERN = /what do you want to achieve today\??/i;

function parseOpeningSummary(text) {
  const lines = String(text || '').split(/\n/);
  const title = String(lines[0] || '').trim();
  const questionIndex = lines.findIndex((line) => OPENING_QUESTION_PATTERN.test(String(line || '')));
  const bodyLines = lines
    .slice(1, questionIndex >= 0 ? questionIndex : lines.length)
    .map((line) => String(line || '').trim())
    .filter(Boolean);
  const firstLabelIndex = bodyLines.findIndex((line) => OPENING_LABEL_PATTERN.test(line));
  const subtitle = firstLabelIndex > 0 || firstLabelIndex === -1
    ? bodyLines.slice(0, firstLabelIndex === -1 ? bodyLines.length : firstLabelIndex).join(' ')
    : '';
  const sectionLines = firstLabelIndex >= 0 ? bodyLines.slice(firstLabelIndex) : [];
  const question = questionIndex >= 0
    ? lines.slice(questionIndex).join(' ').trim()
    : '';

  return {
    title,
    subtitle,
    sections: sectionLines.map((line) => {
      const match = OPENING_LABEL_PATTERN.exec(line);
      if (!match) {
        return { label: null, body: line };
      }
      return {
        label: match[1][0].toUpperCase() + match[1].slice(1).toLowerCase(),
        body: String(match[2] || '').trim(),
      };
    }),
    question,
  };
}

function OpeningSummaryContent({ text }) {
  const summary = parseOpeningSummary(text);
  const hasStructuredSummary = Boolean(
    summary.subtitle
      || summary.question
      || summary.sections.length > 0,
  );
  if (!summary.title || !hasStructuredSummary) {
    return (
      <Text style={styles.openingBodyText}>
        {text}
      </Text>
    );
  }

  return (
    <View style={styles.openingSummary}>
      <Text style={styles.openingTitle}>{summary.title}</Text>
      {summary.subtitle ? (
        <Text style={styles.openingSubtitle}>{summary.subtitle}</Text>
      ) : null}
      {summary.sections.map((section, index) => (
        <Text key={`${section.label || 'line'}-${index}`} style={styles.openingBodyText}>
          {section.label ? (
            <Text style={styles.openingLabel}>{section.label}</Text>
          ) : null}
          {section.label ? ': ' : ''}
          {section.body}
        </Text>
      ))}
      {summary.question ? (
        <Text style={styles.openingQuestion}>{summary.question}</Text>
      ) : null}
    </View>
  );
}

export default function ChatBubble({
  role,
  text,
  isError = false,
  fallbackTriggered = false,
  showSpeakerLabel = true,
  speakerLabel,
  groupPosition = 'single',
  messageKind = null,
  onLongPress = null,
  copyFeedback = null,
  copyFeedbackTone = 'secondary',
}) {
  const isUser = role === 'user';
  const resolvedSpeakerLabel = speakerLabel || (isUser ? 'You' : 'Coach');
  const safeAssistantText = useMemo(
    () => sanitizeAssistantDisplayText(text),
    [text],
  );
  const shouldRenderStructuredAssistant = (
    AI_RESPONSE_RENDERING_V1_ENABLED
    && !isUser
    && !isError
    && messageKind !== 'assistant_stream'
    && messageKind !== 'assistant_progress'
    && messageKind !== 'assistant_opening_summary'
  );
  const structuredModel = useMemo(() => {
    if (!shouldRenderStructuredAssistant) {
      return null;
    }
    return parseAIResponseText(safeAssistantText);
  }, [safeAssistantText, shouldRenderStructuredAssistant]);
  const assistantRenderContent = useMemo(() => {
    if (messageKind === 'assistant_opening_summary') {
      return <OpeningSummaryContent text={safeAssistantText} />;
    }
    if (!structuredModel || !Array.isArray(structuredModel.blocks) || structuredModel.blocks.length === 0) {
      return null;
    }
    return (
      <AIResponseRenderer
        model={structuredModel}
        testIDPrefix="chat-ai-response"
      />
    );
  }, [messageKind, safeAssistantText, structuredModel]);

  return (
    <View style={[styles.row, isUser ? styles.userRow : styles.assistantRow]}>
      {isUser ? (
        <ChatBubbleUser
          text={String(text || '')}
          isError={isError}
          showSpeakerLabel={showSpeakerLabel}
          speakerLabel={resolvedSpeakerLabel}
          groupPosition={groupPosition}
        />
      ) : (
        <ChatBubbleAI
          text={safeAssistantText}
          isError={isError}
          showSpeakerLabel={showSpeakerLabel}
          speakerLabel={resolvedSpeakerLabel}
          groupPosition={groupPosition}
          renderContent={assistantRenderContent}
          onLongPress={onLongPress}
        />
      )}

      {copyFeedback ? (
        <View style={styles.copyFeedbackTag}>
          <ModeText variant="caption" tone={copyFeedbackTone} style={styles.metaText}>
            {copyFeedback}
          </ModeText>
        </View>
      ) : null}

      {fallbackTriggered ? (
        <View style={[styles.fallbackTag, isUser && styles.userFallbackTag]}>
          <ModeText variant="caption" tone={isUser ? 'inverse' : 'secondary'} style={styles.metaText}>
            Flagged for trainer review
          </ModeText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    width: '100%',
    marginBottom: 0,
    gap: 4,
  },
  assistantRow: {
    alignItems: 'flex-start',
  },
  userRow: {
    alignItems: 'flex-end',
  },
  fallbackTag: {
    borderRadius: theme.radii.pill,
    backgroundColor: 'rgba(224, 237, 255, 0.11)',
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 4,
    alignSelf: 'flex-start',
    overflow: 'hidden',
  },
  userFallbackTag: {
    alignSelf: 'flex-end',
    backgroundColor: theme.colors.accent.soft,
  },
  copyFeedbackTag: {
    alignSelf: 'flex-start',
    borderRadius: theme.radii.pill,
    backgroundColor: 'rgba(224, 237, 255, 0.1)',
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 4,
    overflow: 'hidden',
  },
  metaText: {
    fontWeight: '600',
  },
  openingSummary: {
    gap: 7,
  },
  openingTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '800',
    color: 'rgba(255, 255, 255, 0.96)',
  },
  openingSubtitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.body1.fontSize,
    lineHeight: theme.typography.body1.lineHeight,
    color: 'rgba(255, 255, 255, 0.92)',
  },
  openingBodyText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.body1.fontSize,
    lineHeight: theme.typography.body1.lineHeight,
    color: 'rgba(255, 255, 255, 0.94)',
  },
  openingLabel: {
    fontWeight: '800',
    color: 'rgba(255, 255, 255, 0.96)',
  },
  openingQuestion: {
    marginTop: theme.spacing[2],
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.body1.fontSize,
    lineHeight: theme.typography.body1.lineHeight,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.95)',
  },
});

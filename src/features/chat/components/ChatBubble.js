import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { ModeText } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import { ChatBubbleAI, ChatBubbleUser } from '../../../../lib/components/glass';
import { AI_RESPONSE_RENDERING_V1_ENABLED } from '../../../config/featureFlags';
import AIResponseRenderer from './AIResponseRenderer';
import { parseAIResponseText, sanitizeAssistantDisplayText } from '../utils/aiResponseParser';

export default function ChatBubble({
  role,
  text,
  isError = false,
  fallbackTriggered = false,
  showSpeakerLabel = true,
  speakerLabel,
  groupPosition = 'single',
  messageKind = null,
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
  );
  const structuredModel = useMemo(() => {
    if (!shouldRenderStructuredAssistant) {
      return null;
    }
    return parseAIResponseText(safeAssistantText);
  }, [safeAssistantText, shouldRenderStructuredAssistant]);
  const assistantRenderContent = useMemo(() => {
    if (!structuredModel || !Array.isArray(structuredModel.blocks) || structuredModel.blocks.length === 0) {
      return null;
    }
    return (
      <AIResponseRenderer
        model={structuredModel}
        testIDPrefix="chat-ai-response"
      />
    );
  }, [structuredModel]);

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
        />
      )}

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
  metaText: {
    fontWeight: '600',
  },
});

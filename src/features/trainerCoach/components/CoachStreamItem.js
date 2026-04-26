import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ModeText } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import { AI_RESPONSE_RENDERING_V1_ENABLED } from '../../../config/featureFlags';
import { resolveAssistantDisplayName } from '../../messaging';
import AIResponseRenderer from '../../chat/components/AIResponseRenderer';
import { parseAIResponseText, stripEmojiForDisplay } from '../../chat/utils/aiResponseParser';

function resolveKindLabel(kind, assistantDisplayName) {
  if (kind === 'trainer_input') {
    return 'Trainer';
  }
  if (kind === 'internal_ai_private') {
    return resolveAssistantDisplayName(assistantDisplayName);
  }
  if (kind === 'system_confirmation') {
    return 'System';
  }
  if (kind === 'client_message_draft') {
    return 'Client Draft';
  }
  if (kind === 'client_message_sent') {
    return 'Client Sent';
  }
  return 'System';
}

function styleByKind(kind) {
  if (kind === 'trainer_input') {
    return {
      container: styles.trainerInput,
      textTone: 'primary',
      textStyle: styles.trainerInputText,
    };
  }
  if (kind === 'internal_ai_private') {
    return {
      container: styles.internal,
      textTone: 'primary',
    };
  }
  if (kind === 'client_message_draft') {
    return {
      container: styles.clientDraft,
      textTone: 'primary',
    };
  }
  if (kind === 'client_message_sent') {
    return {
      container: styles.clientSent,
      textTone: 'primary',
    };
  }
  return {
    container: styles.system,
    textTone: 'secondary',
    textStyle: null,
  };
}

function shouldRenderStructuredStreamItem(kind, status) {
  if (!AI_RESPONSE_RENDERING_V1_ENABLED) {
    return false;
  }
  if (status === 'pending') {
    return false;
  }
  return kind === 'internal_ai_private' || kind === 'client_message_draft';
}

function CoachStreamItem({
  item,
  assistantDisplayName,
  showRoleLabel = true,
  onLongPressMessage = null,
}) {
  const kind = item?.kind || 'system_confirmation';
  const style = styleByKind(kind);
  const streamStatus = typeof item?.status === 'string' ? item.status : 'confirmed';
  const safeText = useMemo(
    () => stripEmojiForDisplay(String(item?.text || '')),
    [item?.text],
  );
  const isTrainerCommand = kind === 'trainer_input' && safeText.trim().startsWith('/');
  const structuredModel = useMemo(() => {
    if (!shouldRenderStructuredStreamItem(kind, streamStatus)) {
      return null;
    }
    return parseAIResponseText(safeText);
  }, [kind, safeText, streamStatus]);
  const hasStructuredBlocks = Boolean(
    structuredModel
    && Array.isArray(structuredModel.blocks)
    && structuredModel.blocks.length > 0,
  );
  const supportsLongPress = (
    typeof onLongPressMessage === 'function'
    && (
      kind === 'trainer_input'
      || kind === 'internal_ai_private'
      || kind === 'client_message_draft'
    )
    && safeText.trim().length > 0
  );

  const bubble = isTrainerCommand ? (
    <View style={styles.commandBubble}>
      <ModeText variant="caption" tone="secondary" style={styles.commandText}>
        {safeText}
      </ModeText>
    </View>
  ) : (
    <View style={[styles.bubble, style.container]}>
      {hasStructuredBlocks ? (
        <AIResponseRenderer
          model={structuredModel}
          testIDPrefix="coach-stream-ai-response"
        />
      ) : (
        <ModeText variant="bodySm" tone={style.textTone} style={style.textStyle}>
          {safeText}
        </ModeText>
      )}
    </View>
  );

  return (
    <View style={styles.row}>
      {showRoleLabel ? (
        <ModeText variant="caption" tone="tertiary" style={styles.label}>
          {resolveKindLabel(kind, assistantDisplayName)}
        </ModeText>
      ) : null}
      {supportsLongPress ? (
        <Pressable
          onLongPress={() => onLongPressMessage?.(item)}
          delayLongPress={260}
          style={({ pressed }) => [styles.longPressWrap, pressed && styles.longPressPressed]}
        >
          {bubble}
        </Pressable>
      ) : (
        bubble
      )}
    </View>
  );
}

function areEqualCoachStreamItemProps(previousProps, nextProps) {
  const previousItem = previousProps?.item || {};
  const nextItem = nextProps?.item || {};
  const previousAssistantDisplayName = previousProps?.assistantDisplayName || null;
  const nextAssistantDisplayName = nextProps?.assistantDisplayName || null;
  if (previousItem === nextItem) {
    return previousAssistantDisplayName === nextAssistantDisplayName;
  }
  return (
    previousAssistantDisplayName === nextAssistantDisplayName
    && Boolean(previousProps?.showRoleLabel) === Boolean(nextProps?.showRoleLabel)
    && previousItem.id === nextItem.id
    && previousItem.kind === nextItem.kind
    && previousItem.text === nextItem.text
    && previousItem.status === nextItem.status
    && previousItem.severity === nextItem.severity
    && previousItem.visibility === nextItem.visibility
  );
}

const MemoizedCoachStreamItem = React.memo(CoachStreamItem, areEqualCoachStreamItemProps);

export default MemoizedCoachStreamItem;

const styles = StyleSheet.create({
  row: {
    gap: 2,
  },
  longPressWrap: {
    borderRadius: theme.radii.lg,
  },
  longPressPressed: {
    opacity: 0.9,
  },
  label: {
    fontWeight: '600',
    letterSpacing: 0.28,
  },
  bubble: {
    borderRadius: theme.radii.lg,
    borderWidth: 1,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  trainerInput: {
    backgroundColor: 'rgba(95, 141, 231, 0.18)',
    borderColor: 'rgba(157, 196, 255, 0.34)',
  },
  trainerInputText: {
    color: 'rgba(245, 250, 255, 0.96)',
  },
  internal: {
    backgroundColor: 'rgba(11, 20, 34, 0.76)',
    borderColor: 'rgba(229, 241, 255, 0.14)',
  },
  system: {
    backgroundColor: theme.colors.surface.base,
    borderColor: theme.colors.border.subtle,
  },
  clientDraft: {
    backgroundColor: theme.colors.feedback.warningBg,
    borderColor: theme.colors.feedback.warningBorder,
  },
  clientSent: {
    backgroundColor: theme.colors.feedback.successBg,
    borderColor: theme.colors.feedback.successBorder,
  },
  commandBubble: {
    alignSelf: 'flex-start',
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    borderColor: 'rgba(220, 236, 255, 0.2)',
    backgroundColor: 'rgba(14, 24, 41, 0.72)',
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 5,
    maxWidth: '82%',
  },
  commandText: {
    fontWeight: '600',
  },
});

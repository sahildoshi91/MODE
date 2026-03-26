import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { theme } from '../../../../lib/theme';

function formatTokenUsage(tokenUsage) {
  if (!tokenUsage) {
    return null;
  }

  const promptTokens = tokenUsage.prompt_tokens ?? 0;
  const completionTokens = tokenUsage.completion_tokens ?? 0;
  const totalTokens = tokenUsage.total_tokens ?? 0;
  return `Tokens in ${promptTokens} • out ${completionTokens} • total ${totalTokens}`;
}

function formatConversationUsage(conversationUsage) {
  if (!conversationUsage) {
    return null;
  }

  const totalTokens = conversationUsage.total_tokens ?? 0;
  const totalPromptTokens = conversationUsage.total_prompt_tokens ?? 0;
  const totalCompletionTokens = conversationUsage.total_completion_tokens ?? 0;
  return `Conversation tokens ${totalTokens} • in ${totalPromptTokens} • out ${totalCompletionTokens}`;
}

function formatModel(routeDebug, conversationUsage) {
  const provider = routeDebug?.execution_provider || conversationUsage?.last_execution_provider;
  const model = routeDebug?.execution_model || conversationUsage?.last_execution_model;
  if (!provider || !model) {
    return null;
  }

  return `Model ${provider}/${model}`;
}

export default function ChatBubble({
  role,
  text,
  isError = false,
  fallbackTriggered = false,
  tokenUsage = null,
  routeDebug = null,
  conversationUsage = null,
}) {
  const isUser = role === 'user';
  const tokenUsageLabel = !isUser && !isError ? formatTokenUsage(tokenUsage) : null;
  const conversationUsageLabel = !isUser && !isError ? formatConversationUsage(conversationUsage) : null;
  const modelLabel = !isUser && !isError ? formatModel(routeDebug, conversationUsage) : null;

  return (
    <View style={[styles.row, isUser ? styles.userRow : styles.assistantRow]}>
      <View
        style={[
          styles.bubble,
          isUser ? styles.userBubble : styles.assistantBubble,
          isError && styles.errorBubble,
        ]}
      >
        <Text style={[styles.text, isUser && styles.userText]}>{text}</Text>
        {fallbackTriggered ? (
          <Text style={styles.metaText}>Flagged for trainer review</Text>
        ) : null}
        {tokenUsageLabel ? (
          <Text style={styles.metaText}>{tokenUsageLabel}</Text>
        ) : null}
        {conversationUsageLabel ? (
          <Text style={styles.metaText}>{conversationUsageLabel}</Text>
        ) : null}
        {modelLabel ? (
          <Text style={styles.metaText}>{modelLabel}</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    width: '100%',
    marginBottom: theme.spacing[2],
  },
  assistantRow: {
    alignItems: 'flex-start',
  },
  userRow: {
    alignItems: 'flex-end',
  },
  bubble: {
    maxWidth: '86%',
    borderRadius: theme.radii.l,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    borderWidth: 1,
  },
  assistantBubble: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
  },
  userBubble: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  errorBubble: {
    borderColor: theme.colors.error,
  },
  text: {
    color: theme.colors.textHigh,
    ...theme.typography.body1,
  },
  userText: {
    color: theme.colors.onPrimary,
  },
  metaText: {
    marginTop: theme.spacing[1],
    color: theme.colors.textMedium,
    ...theme.typography.body3,
  },
});

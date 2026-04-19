import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ModeText } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';

function resolveKindLabel(kind) {
  if (kind === 'trainer_input') {
    return 'Trainer';
  }
  if (kind === 'internal_ai_private') {
    return 'Internal AI';
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

function CoachStreamItem({ item }) {
  const kind = item?.kind || 'system_confirmation';
  const style = styleByKind(kind);
  return (
    <View style={styles.row}>
      <ModeText variant="caption" tone="tertiary" style={styles.label}>
        {resolveKindLabel(kind)}
      </ModeText>
      <View style={[styles.bubble, style.container]}>
        <ModeText variant="bodySm" tone={style.textTone} style={style.textStyle}>
          {item?.text || ''}
        </ModeText>
      </View>
    </View>
  );
}

function areEqualCoachStreamItemProps(previousProps, nextProps) {
  const previousItem = previousProps?.item || {};
  const nextItem = nextProps?.item || {};
  if (previousItem === nextItem) {
    return true;
  }
  return (
    previousItem.id === nextItem.id
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
    gap: 4,
  },
  label: {
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    fontWeight: '700',
  },
  bubble: {
    borderRadius: theme.radii.lg,
    borderWidth: 1,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1] + 2,
  },
  trainerInput: {
    backgroundColor: theme.colors.cta.primaryBg,
    borderColor: theme.colors.cta.primaryBorder,
  },
  trainerInputText: {
    color: '#FFFFFF',
  },
  internal: {
    backgroundColor: theme.colors.surface.elevated,
    borderColor: theme.colors.border.default,
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
});

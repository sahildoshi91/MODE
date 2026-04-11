import React from 'react';
import { StyleSheet, View } from 'react-native';

import { theme } from '../theme';
import { ModeButton } from './ModeButton';
import { ModeText } from './ModeText';

export const EmptyState = ({
  title,
  body,
  ctaLabel,
  onPress,
  style,
  testID,
}) => {
  return (
    <View testID={testID} style={[styles.container, style]}>
      <ModeText variant="h3" style={styles.title}>{title}</ModeText>
      {body ? <ModeText variant="bodySm" tone="secondary" style={styles.body}>{body}</ModeText> : null}
      {ctaLabel && typeof onPress === 'function' ? (
        <ModeButton title={ctaLabel} onPress={onPress} variant="secondary" style={styles.button} />
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: theme.radii.l,
    borderWidth: 1,
    borderColor: theme.colors.border.soft,
    backgroundColor: theme.colors.surface.base,
    padding: theme.spacing[3],
    alignItems: 'center',
    justifyContent: 'center',
    ...theme.shadows.soft,
  },
  title: {
    textAlign: 'center',
  },
  body: {
    textAlign: 'center',
    marginTop: theme.spacing[1],
  },
  button: {
    marginTop: theme.spacing[2],
    minWidth: 150,
  },
});

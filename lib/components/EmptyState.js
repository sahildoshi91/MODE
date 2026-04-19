import React from 'react';
import { StyleSheet } from 'react-native';

import { ModeButton } from './ModeButton';
import { EmptyStateGlassPanel } from './glass/GlassData';

export const EmptyState = ({
  title,
  body,
  ctaLabel,
  onPress,
  style,
  testID,
}) => {
  return (
    <EmptyStateGlassPanel
      testID={testID}
      title={title}
      body={body}
      style={[styles.container, style]}
      action={(
        ctaLabel && typeof onPress === 'function'
          ? <ModeButton title={ctaLabel} onPress={onPress} variant="secondary" style={styles.button} />
          : null
      )}
    />
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 0,
  },
  button: {
    minWidth: 150,
  },
});

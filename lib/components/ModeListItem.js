import React from 'react';
import { Text, StyleSheet } from 'react-native';

import { theme } from '../theme';
import { GlassRow } from './glass/GlassSurface';

export const ModeListItem = ({ title, subtitle, rightText, style, testID }) => {
  return (
    <GlassRow
      testID={testID}
      style={[styles.item, style]}
      title={<Text style={styles.title}>{title}</Text>}
      subtitle={subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      trailing={rightText ? <Text style={styles.right}>{rightText}</Text> : null}
    />
  );
};

const styles = StyleSheet.create({
  item: {
    marginBottom: theme.spacing[1],
  },
  title: {
    color: theme.colors.text.primary,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.body1.fontSize,
    lineHeight: theme.typography.body1.lineHeight,
    fontWeight: '600',
  },
  subtitle: {
    color: theme.colors.text.tertiary,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.body2.fontSize,
    lineHeight: theme.typography.body2.lineHeight,
    marginTop: theme.spacing[0],
  },
  right: {
    color: theme.colors.accent.primary,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.body2.fontSize,
    lineHeight: theme.typography.body2.lineHeight,
    fontWeight: '600',
  },
});

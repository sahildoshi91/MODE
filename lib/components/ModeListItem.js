import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../theme';

export const ModeListItem = ({ title, subtitle, rightText, style, testID }) => {
  return (
    <View testID={testID} style={[styles.item, style]}>
      <View style={styles.content}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {rightText ? <Text style={styles.right}>{rightText}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  item: {
    width: '100%',
    borderRadius: theme.radii.m,
    backgroundColor: theme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing[2],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing[1],
  },
  content: {
    flex: 1,
    marginRight: theme.spacing[2],
  },
  title: {
    color: theme.colors.textHigh,
    fontSize: theme.typography.h3.fontSize,
    lineHeight: theme.typography.h3.lineHeight,
    fontWeight: theme.typography.h3.fontWeight,
  },
  subtitle: {
    color: theme.colors.textMedium,
    fontSize: theme.typography.body2.fontSize,
    lineHeight: theme.typography.body2.lineHeight,
    marginTop: theme.spacing[0],
  },
  right: {
    color: theme.colors.secondary,
    fontSize: theme.typography.body2.fontSize,
    fontWeight: '600',
  },
});

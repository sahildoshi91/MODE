import React from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import { theme } from '../theme';
import { ModeCard } from './ModeCard';

export function SystemActionSheet({
  visible,
  onClose,
  children,
  testID,
}) {
  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <View testID={testID} style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.sheetDock}>
          <ModeCard variant="surface" style={styles.sheet}>
            <View style={styles.grabber} />
            {children}
          </ModeCard>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(3, 8, 16, 0.36)',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheetDock: {
    paddingHorizontal: theme.spacing[2],
    paddingBottom: theme.spacing[2],
  },
  sheet: {
    borderBottomLeftRadius: theme.radii.l,
    borderBottomRightRadius: theme.radii.l,
    gap: theme.spacing[2],
  },
  grabber: {
    width: 42,
    height: 4,
    borderRadius: 999,
    alignSelf: 'center',
    backgroundColor: theme.colors.border.default,
  },
});

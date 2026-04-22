import React, { useEffect, useState } from 'react';
import {
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import { theme } from '../theme';
import { ModeCard } from './ModeCard';

const KEYBOARD_OPEN_EVENT = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
const KEYBOARD_CLOSE_EVENT = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

function resolveKeyboardHeight(event) {
  const nextHeight = Number(event?.endCoordinates?.height) || 0;
  return Math.max(0, nextHeight);
}

export function SystemActionSheet({
  visible,
  onClose,
  children,
  testID,
  keyboardLiftEnabled = true,
}) {
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (!visible || !keyboardLiftEnabled) {
      setKeyboardHeight(0);
      return undefined;
    }
    const openSubscription = Keyboard.addListener(KEYBOARD_OPEN_EVENT, (event) => {
      setKeyboardHeight(resolveKeyboardHeight(event));
    });
    const closeSubscription = Keyboard.addListener(KEYBOARD_CLOSE_EVENT, () => {
      setKeyboardHeight(0);
    });
    return () => {
      openSubscription.remove();
      closeSubscription.remove();
    };
  }, [visible, keyboardLiftEnabled]);

  const sheetKeyboardLift = visible && keyboardLiftEnabled && keyboardHeight > 0
    ? keyboardHeight + theme.spacing[1]
    : 0;

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <View testID={testID} style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View
          testID={testID ? `${testID}-dock` : undefined}
          style={[
            styles.sheetDock,
            { marginBottom: sheetKeyboardLift },
          ]}
        >
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

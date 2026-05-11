import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Keyboard, Platform, StyleSheet, View } from 'react-native';

import { theme } from '../../../lib/theme';
import { SystemActionSheet } from '../../../lib/components/SystemActionSheet';

describe('SystemActionSheet', () => {
  const openEventName = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
  const closeEventName = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
  let keyboardListeners = {};
  let keyboardRemoveMocks = [];
  let keyboardAddListenerSpy;

  function renderSheet(props = {}) {
    let tree;
    act(() => {
      tree = renderer.create(
        <SystemActionSheet
          visible
          onClose={jest.fn()}
          testID="system-action-sheet"
          {...props}
        >
          <View />
        </SystemActionSheet>,
      );
    });
    return tree;
  }

  beforeEach(() => {
    keyboardListeners = {};
    keyboardRemoveMocks = [];
    keyboardAddListenerSpy = jest.spyOn(Keyboard, 'addListener').mockImplementation((eventName, callback) => {
      keyboardListeners[eventName] = callback;
      const remove = jest.fn(() => {
        if (keyboardListeners[eventName] === callback) {
          delete keyboardListeners[eventName];
        }
      });
      keyboardRemoveMocks.push(remove);
      return { remove };
    });
  });

  afterEach(() => {
    keyboardAddListenerSpy?.mockRestore();
  });

  it('lifts the sheet above the keyboard and resets after keyboard close', () => {
    const tree = renderSheet();
    const findSheetDock = () => tree.root.findByProps({ testID: 'system-action-sheet-dock' });

    expect(StyleSheet.flatten(findSheetDock().props.style).marginBottom).toBe(0);

    act(() => {
      keyboardListeners[openEventName]?.({
        endCoordinates: { height: 216 },
      });
    });

    expect(StyleSheet.flatten(findSheetDock().props.style).marginBottom).toBe(216 + theme.spacing[1]);

    act(() => {
      keyboardListeners[closeEventName]?.();
    });

    expect(StyleSheet.flatten(findSheetDock().props.style).marginBottom).toBe(0);

    act(() => {
      tree.unmount();
    });
  });

  it('cleans up keyboard listeners when the sheet is hidden', () => {
    const tree = renderSheet();

    expect(keyboardRemoveMocks).toHaveLength(2);
    keyboardRemoveMocks.forEach((remove) => {
      expect(remove).not.toHaveBeenCalled();
    });

    act(() => {
      tree.update(
        <SystemActionSheet visible={false} onClose={jest.fn()} testID="system-action-sheet">
          <View />
        </SystemActionSheet>,
      );
    });

    keyboardRemoveMocks.forEach((remove) => {
      expect(remove).toHaveBeenCalledTimes(1);
    });

    expect(
      tree.root.findAll((node) => node.props?.testID === 'system-action-sheet-dock'),
    ).toHaveLength(0);

    act(() => {
      tree.unmount();
    });
  });

  it('cleans up keyboard listeners when unmounted while visible', () => {
    const tree = renderSheet();

    expect(keyboardRemoveMocks).toHaveLength(2);
    const [openRemove, closeRemove] = keyboardRemoveMocks;

    act(() => {
      tree.unmount();
    });

    expect(openRemove).toHaveBeenCalledTimes(1);
    expect(closeRemove).toHaveBeenCalledTimes(1);
  });

  it('does not register keyboard listeners when keyboard lift is disabled', () => {
    const tree = renderSheet({ keyboardLiftEnabled: false });

    expect(keyboardAddListenerSpy).not.toHaveBeenCalled();
    expect(
      StyleSheet.flatten(tree.root.findByProps({ testID: 'system-action-sheet-dock' }).props.style).marginBottom,
    ).toBe(0);

    act(() => {
      tree.unmount();
    });
  });
});

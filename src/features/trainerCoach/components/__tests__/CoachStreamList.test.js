import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { FlatList, Platform } from 'react-native';

jest.mock('../CoachStreamItem', () => {
  const React = require('react');
  return function MockCoachStreamItem(props) {
    return React.createElement('MockCoachStreamItem', props);
  };
});

import CoachStreamList from '../CoachStreamList';

describe('CoachStreamList', () => {
  it('keeps keyboard-dismiss props enabled even when stream is empty', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <CoachStreamList streamItems={[]} />,
      );
    });

    const list = tree.root.findByType(FlatList);
    expect(list.props.keyboardShouldPersistTaps).toBe('never');
    expect(list.props.keyboardDismissMode).toBe(Platform.OS === 'ios' ? 'interactive' : 'on-drag');
    const emptyLabelNodes = tree.root.findAll(
      (node) => node?.props?.children === 'No coach activity yet. Start with a prompt or slash command.',
    );
    expect(emptyLabelNodes.length).toBeGreaterThan(0);
  });

  it('reports scroll depth updates from stream list scrolling', async () => {
    const onScrollDepthChange = jest.fn();
    let tree;
    await act(async () => {
      tree = renderer.create(
        <CoachStreamList
          streamItems={[{ id: 'item-1', kind: 'system_confirmation', text: 'hello' }]}
          onScrollDepthChange={onScrollDepthChange}
        />,
      );
    });

    const list = tree.root.findByType(FlatList);
    act(() => {
      list.props.onScroll({
        nativeEvent: {
          contentOffset: { y: 220 },
        },
      });
    });

    expect(onScrollDepthChange).toHaveBeenCalledWith(220);
  });
});

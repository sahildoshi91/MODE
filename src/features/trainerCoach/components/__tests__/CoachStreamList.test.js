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
  function buildListHandle() {
    return {
      scrollToIndex: jest.fn(),
      scrollToEnd: jest.fn(),
      scrollToOffset: jest.fn(),
    };
  }

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

    await act(async () => {
      tree.unmount();
    });
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

    await act(async () => {
      tree.unmount();
    });
  });

  it('auto-scrolls to the latest item on initial render when stream has content', async () => {
    const listHandle = buildListHandle();
    const listRef = { current: listHandle };
    let tree;
    await act(async () => {
      tree = renderer.create(
        <CoachStreamList
          streamItems={[{ id: 'item-1', kind: 'system_confirmation', text: 'hello' }]}
          listRef={listRef}
        />,
      );
    });

    expect(listHandle.scrollToIndex).toHaveBeenCalledWith(
      expect.objectContaining({ index: 0 }),
    );

    await act(async () => {
      tree.unmount();
    });
  });

  it('auto-scrolls on appended items when the viewport is near the bottom', async () => {
    const listHandle = buildListHandle();
    const listRef = { current: listHandle };
    let tree;
    await act(async () => {
      tree = renderer.create(
        <CoachStreamList
          streamItems={[{ id: 'item-1', kind: 'system_confirmation', text: 'one' }]}
          listRef={listRef}
        />,
      );
    });
    listHandle.scrollToEnd.mockClear();

    await act(async () => {
      tree.update(
        <CoachStreamList
          streamItems={[
            { id: 'item-1', kind: 'system_confirmation', text: 'one' },
            { id: 'item-2', kind: 'system_confirmation', text: 'two' },
          ]}
          listRef={listRef}
        />,
      );
    });

    expect(listHandle.scrollToIndex).toHaveBeenCalledWith(
      expect.objectContaining({ index: 1 }),
    );

    await act(async () => {
      tree.unmount();
    });
  });

  it('supports force-scroll triggers via forceScrollSignal updates', async () => {
    const listHandle = buildListHandle();
    const listRef = { current: listHandle };
    let tree;
    await act(async () => {
      tree = renderer.create(
        <CoachStreamList
          streamItems={[{ id: 'item-1', kind: 'system_confirmation', text: 'one' }]}
          listRef={listRef}
          forceScrollSignal={0}
        />,
      );
    });
    listHandle.scrollToIndex.mockClear();
    listHandle.scrollToEnd.mockClear();

    await act(async () => {
      tree.update(
        <CoachStreamList
          streamItems={[{ id: 'item-1', kind: 'system_confirmation', text: 'one' }]}
          listRef={listRef}
          forceScrollSignal={1}
        />,
      );
    });

    expect(listHandle.scrollToIndex).toHaveBeenCalled();

    await act(async () => {
      tree.unmount();
    });
  });
});

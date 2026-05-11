import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { FlatList, Platform, StyleSheet } from 'react-native';

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

  function markListReady(tree, {
    layoutHeight = 500,
    contentHeight = 1200,
    offset = 700,
  } = {}) {
    const list = tree.root.findByType(FlatList);
    act(() => {
      list.props.onLayout?.({
        nativeEvent: {
          layout: { height: layoutHeight },
        },
      });
      list.props.onContentSizeChange?.(0, contentHeight);
      if (Number.isFinite(offset)) {
        list.props.onScroll?.({
          nativeEvent: {
            contentOffset: { y: offset },
            contentSize: { height: contentHeight },
            layoutMeasurement: { height: layoutHeight },
          },
        });
      }
    });
  }

  it('keeps keyboard-dismiss props enabled even when stream is empty', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <CoachStreamList streamItems={[]} />,
      );
    });

    const list = tree.root.findByType(FlatList);
    expect(list.props.keyboardShouldPersistTaps).toBe('handled');
    expect(list.props.keyboardDismissMode).toBe(Platform.OS === 'ios' ? 'interactive' : 'on-drag');
    const emptyLabelNodes = tree.root.findAll(
      (node) => node?.props?.children === 'No conversation yet. Message Coach AI to get started.',
    );
    expect(emptyLabelNodes.length).toBeGreaterThan(0);

    await act(async () => {
      tree.unmount();
    });
  });

  it('uses the resolved assistant display name in empty-state guidance copy', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <CoachStreamList
          streamItems={[]}
          assistantDisplayName="Atlas"
        />,
      );
    });

    const emptyLabelNodes = tree.root.findAll(
      (node) => node?.props?.children === 'No conversation yet. Message Atlas to get started.',
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
    expect(listHandle.scrollToEnd).not.toHaveBeenCalled();

    markListReady(tree);

    expect(listHandle.scrollToEnd).toHaveBeenCalled();

    await act(async () => {
      tree.unmount();
    });
  });

  it('keeps content hidden until initial bottom snap is settled', async () => {
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

    let list = tree.root.findByType(FlatList);
    expect(StyleSheet.flatten(list.props.style)?.opacity).toBe(0);

    markListReady(tree);

    list = tree.root.findByType(FlatList);
    expect(StyleSheet.flatten(list.props.style)?.opacity).toBeUndefined();

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
    markListReady(tree);
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

    expect(listHandle.scrollToEnd).toHaveBeenCalled();

    await act(async () => {
      tree.unmount();
    });
  });

  it('reports appended items below fold when user is away from bottom', async () => {
    const listHandle = buildListHandle();
    const listRef = { current: listHandle };
    const onNewItemsWhileAwayFromBottom = jest.fn();
    let tree;
    await act(async () => {
      tree = renderer.create(
        <CoachStreamList
          streamItems={[{ id: 'item-1', kind: 'system_confirmation', text: 'one' }]}
          listRef={listRef}
          onNewItemsWhileAwayFromBottom={onNewItemsWhileAwayFromBottom}
        />,
      );
    });
    markListReady(tree, { offset: 0 });
    listHandle.scrollToEnd.mockClear();

    await act(async () => {
      tree.update(
        <CoachStreamList
          streamItems={[
            { id: 'item-1', kind: 'system_confirmation', text: 'one' },
            { id: 'item-2', kind: 'system_confirmation', text: 'two' },
          ]}
          listRef={listRef}
          onNewItemsWhileAwayFromBottom={onNewItemsWhileAwayFromBottom}
        />,
      );
    });

    expect(onNewItemsWhileAwayFromBottom).toHaveBeenCalledWith({ addedCount: 1 });
    expect(listHandle.scrollToEnd).not.toHaveBeenCalled();

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

    expect(listHandle.scrollToEnd).toHaveBeenCalled();

    await act(async () => {
      tree.unmount();
    });
  });

  it('supports explicit anchor-to-latest signals independent of force-scroll signal', async () => {
    const listHandle = buildListHandle();
    const listRef = { current: listHandle };
    let tree;
    await act(async () => {
      tree = renderer.create(
        <CoachStreamList
          streamItems={[{ id: 'item-1', kind: 'system_confirmation', text: 'one' }]}
          listRef={listRef}
          anchorToLatestSignal={0}
        />,
      );
    });
    markListReady(tree);
    listHandle.scrollToEnd.mockClear();

    await act(async () => {
      tree.update(
        <CoachStreamList
          streamItems={[{ id: 'item-1', kind: 'system_confirmation', text: 'one' }]}
          listRef={listRef}
          anchorToLatestSignal={1}
        />,
      );
    });

    expect(listHandle.scrollToEnd).toHaveBeenCalled();

    await act(async () => {
      tree.unmount();
    });
  });

  it('resets initial anchor flow when threadKey changes', async () => {
    const listHandle = buildListHandle();
    const listRef = { current: listHandle };
    let tree;
    await act(async () => {
      tree = renderer.create(
        <CoachStreamList
          streamItems={[{ id: 'item-1', kind: 'system_confirmation', text: 'one' }]}
          listRef={listRef}
          threadKey="thread-a"
        />,
      );
    });
    markListReady(tree);
    listHandle.scrollToEnd.mockClear();

    await act(async () => {
      tree.update(
        <CoachStreamList
          streamItems={[{ id: 'item-1', kind: 'system_confirmation', text: 'one' }]}
          listRef={listRef}
          threadKey="thread-b"
        />,
      );
    });
    markListReady(tree);

    expect(listHandle.scrollToEnd).toHaveBeenCalled();

    await act(async () => {
      tree.unmount();
    });
  });

  it('re-scrolls to latest when contentBottomPadding grows while near bottom', async () => {
    const listHandle = buildListHandle();
    const listRef = { current: listHandle };
    const streamItems = [{ id: 'item-1', kind: 'system_confirmation', text: 'one' }];
    let tree;
    await act(async () => {
      tree = renderer.create(
        <CoachStreamList
          streamItems={streamItems}
          listRef={listRef}
          contentBottomPadding={0}
        />,
      );
    });
    markListReady(tree);
    listHandle.scrollToIndex.mockClear();
    listHandle.scrollToEnd.mockClear();
    listHandle.scrollToOffset.mockClear();

    await act(async () => {
      tree.update(
        <CoachStreamList
          streamItems={streamItems}
          listRef={listRef}
          contentBottomPadding={64}
        />,
      );
    });

    expect(listHandle.scrollToEnd).toHaveBeenCalled();

    await act(async () => {
      tree.unmount();
    });
  });

  it('restores a prior viewport offset without forcing a jump to latest', async () => {
    const listHandle = buildListHandle();
    const listRef = { current: listHandle };
    const streamItems = [{ id: 'item-1', kind: 'system_confirmation', text: 'one' }];
    let tree;
    await act(async () => {
      tree = renderer.create(
        <CoachStreamList
          streamItems={streamItems}
          listRef={listRef}
          restoreScrollOffset={null}
          restoreScrollSignal={0}
        />,
      );
    });
    listHandle.scrollToEnd.mockClear();
    listHandle.scrollToOffset.mockClear();

    await act(async () => {
      tree.update(
        <CoachStreamList
          streamItems={streamItems}
          listRef={listRef}
          restoreScrollOffset={180}
          restoreScrollSignal={1}
        />,
      );
    });

    expect(listHandle.scrollToOffset).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 180 }),
    );
    expect(listHandle.scrollToEnd).not.toHaveBeenCalled();

    await act(async () => {
      tree.unmount();
    });
  });

  it('suppresses duplicate role labels for consecutive messages from the same speaker', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <CoachStreamList
          streamItems={[
            { id: 'item-1', kind: 'trainer_input', text: 'First trainer message' },
            { id: 'item-2', kind: 'trainer_input', text: 'Second trainer message' },
            { id: 'item-3', kind: 'internal_ai_private', text: 'Coach reply' },
          ]}
        />,
      );
    });

    const renderedItems = tree.root.findAllByType('MockCoachStreamItem');
    expect(renderedItems).toHaveLength(3);
    expect(renderedItems[0].props.showRoleLabel).toBe(true);
    expect(renderedItems[1].props.showRoleLabel).toBe(false);
    expect(renderedItems[2].props.showRoleLabel).toBe(true);

    await act(async () => {
      tree.unmount();
    });
  });

});

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaProvider: ({ children }) => children,
    SafeAreaView: ({ children }) => React.createElement('SafeAreaView', null, children),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { View } = require('react-native');

  return {
    Feather: ({ testID, name, ...props }) => React.createElement(View, {
      ...props,
      testID: testID || `feather-${name}`,
    }),
  };
});

jest.mock('../../../chat/hooks/useStreamingMessage', () => ({
  useStreamingMessage: ({ text }) => ({
    displayedText: text,
    reducedMotion: true,
  }),
}));

jest.mock('../../services/algorithmApi', () => ({
  createMyMemory: jest.fn(),
  deleteMyMemory: jest.fn(),
  getMyAlgorithm: jest.fn(),
  patchMyWhy: jest.fn(),
  updateMyMemory: jest.fn(),
}));

import React from 'react';
import renderer, { act } from 'react-test-renderer';

import AlgorithmHomeScreen from '../AlgorithmHomeScreen';
import {
  createMyMemory,
  deleteMyMemory,
  getMyAlgorithm,
  patchMyWhy,
  updateMyMemory,
} from '../../services/algorithmApi';

let currentTree = null;

function buildAlgorithmPayload(overrides = {}) {
  return {
    client_id: 'client-1',
    summary_text: "You're building consistency.",
    user_why: '',
    algorithm_summary_updated_at: '2026-05-04T12:00:00+00:00',
    memories: [],
    ...overrides,
  };
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderScreen(payload = buildAlgorithmPayload(), props = {}) {
  getMyAlgorithm.mockResolvedValueOnce(payload);

  let tree;
  await act(async () => {
    tree = renderer.create(<AlgorithmHomeScreen accessToken="token-123" {...props} />);
  });
  await flushEffects();
  currentTree = tree;
  return tree;
}

function readNodeText(node) {
  if (typeof node === 'string') {
    return node;
  }

  return (node.children || []).map(readNodeText).join('');
}

function findPressableByTestID(root, testID) {
  const matches = root.findAll((node) => (
    node.props?.testID === testID && typeof node.props?.onPress === 'function'
  ));
  if (matches.length < 1) {
    throw new Error(`Expected at least one pressable with testID ${testID}, found ${matches.length}`);
  }
  return matches[matches.length - 1];
}

describe('AlgorithmHomeScreen inline Why editor', () => {
  afterEach(() => {
    if (currentTree) {
      act(() => {
        currentTree.unmount();
      });
      currentTree = null;
    }
    jest.clearAllMocks();
  });

  it('edits Your Why inline without rendering the old sheet', async () => {
    const tree = await renderScreen();

    expect(tree.root.findAllByProps({ testID: 'algorithm-why-sheet' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'algorithm-memory-sheet' })).toHaveLength(0);
    expect(findPressableByTestID(tree.root, 'algorithm-why-card')).toBeTruthy();

    await act(async () => {
      findPressableByTestID(tree.root, 'algorithm-why-card').props.onPress();
    });

    expect(tree.root.findByProps({ testID: 'algorithm-why-input' }).props.value).toBe('');
    expect(tree.root.findAllByProps({ testID: 'algorithm-why-cancel' })).toHaveLength(0);
    expect(findPressableByTestID(tree.root, 'algorithm-why-save')).toBeTruthy();
    expect(tree.root.findAllByProps({ testID: 'algorithm-why-sheet' })).toHaveLength(0);
  });

  it('renders a mode-aware morning header with readiness', async () => {
    const tree = await renderScreen(buildAlgorithmPayload(), {
      currentMode: 'BUILD',
      readinessScore: 20,
      viewerDisplayName: 'Ari Mode',
    });

    expect(readNodeText(tree.root.findByProps({ testID: 'algorithm-home-greeting' }))).toContain('Ari');
    expect(readNodeText(tree.root.findByProps({ testID: 'algorithm-home-mode-label' }))).toBe('BUILD MODE');
    expect(readNodeText(tree.root.findByProps({ testID: 'algorithm-home-readiness-score' }))).toContain('20 / 25 readiness');
  });

  it('cleans raw username-style display names before greeting', async () => {
    const tree = await renderScreen(buildAlgorithmPayload(), {
      viewerDisplayName: 'test.user',
    });

    expect(readNodeText(tree.root.findByProps({ testID: 'algorithm-home-greeting' }))).toBe('Good morning, Test');
  });

  it('finishes the top summary from Your Why when the API summary is stale-truncated', async () => {
    const tree = await renderScreen(buildAlgorithmPayload({
      summary_text: "You're building strength, energy, and consistency around what matters most: To never have to tell my kids that I'm too",
      user_why: "To never have to tell my kids that I'm too tired to play with them.",
    }));

    const summaryText = readNodeText(tree.root.findByProps({ testID: 'algorithm-summary-card-text' }));

    expect(summaryText).toContain("I'm too tired to play with them.");
    expect(summaryText).not.toBe(
      "You're building strength, energy, and consistency around what matters most: To never have to tell my kids that I'm too",
    );
  });

  it('keeps reconstructed top summaries brief', async () => {
    const tree = await renderScreen(buildAlgorithmPayload({
      user_why: (
        'Have enough energy for school pickup, dinner, homework, weekend hikes, soccer practice, '
        + 'dance recitals, work travel, and the long summer trip without making training the whole calendar.'
      ),
    }));

    const summaryText = readNodeText(tree.root.findByProps({ testID: 'algorithm-summary-card-text' }));

    expect(summaryText.split(/\s+/)).toHaveLength(30);
    expect(summaryText).toMatch(/\.\.\.$/);
  });

  it('saves Your Why through the existing API and exits inline edit mode', async () => {
    const tree = await renderScreen();
    patchMyWhy.mockResolvedValueOnce(buildAlgorithmPayload({
      user_why: 'Dance until I am 100.',
    }));

    await act(async () => {
      findPressableByTestID(tree.root, 'algorithm-why-card').props.onPress();
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'algorithm-why-input' }).props.onChangeText('Dance until I am 100.');
    });
    await act(async () => {
      findPressableByTestID(tree.root, 'algorithm-why-save').props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(patchMyWhy).toHaveBeenCalledWith({
      accessToken: 'token-123',
      userWhy: 'Dance until I am 100.',
    });
    expect(tree.root.findAllByProps({ testID: 'algorithm-why-input' })).toHaveLength(0);
    expect(readNodeText(tree.root)).toContain('Dance until I am 100.');
  });

  it('cancels inline edits from outside tap without saving', async () => {
    const tree = await renderScreen(buildAlgorithmPayload({
      user_why: 'Keep up with my kids.',
    }));

    await act(async () => {
      findPressableByTestID(tree.root, 'algorithm-why-card').props.onPress();
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'algorithm-why-input' }).props.onChangeText('Different draft');
    });
    await act(async () => {
      findPressableByTestID(tree.root, 'algorithm-why-dismiss-backdrop').props.onPress();
    });

    expect(patchMyWhy).not.toHaveBeenCalled();
    expect(tree.root.findAllByProps({ testID: 'algorithm-why-cancel' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'algorithm-why-input' })).toHaveLength(0);
    expect(readNodeText(tree.root)).toContain('Keep up with my kids.');
    expect(readNodeText(tree.root)).not.toContain('Different draft');
  });

  it('keeps inline editor open and shows the error when saving fails', async () => {
    const tree = await renderScreen(buildAlgorithmPayload({
      user_why: 'Original why.',
    }));
    patchMyWhy.mockRejectedValueOnce(new Error('Request failed'));

    await act(async () => {
      findPressableByTestID(tree.root, 'algorithm-why-card').props.onPress();
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'algorithm-why-input' }).props.onChangeText('Draft why.');
    });
    await act(async () => {
      findPressableByTestID(tree.root, 'algorithm-why-save').props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(tree.root.findByProps({ testID: 'algorithm-why-input' }).props.value).toBe('Draft why.');
    expect(readNodeText(tree.root)).toContain('Request failed');
  });

  it('reloads memories when the chat memory refresh token changes', async () => {
    const tree = await renderScreen();
    getMyAlgorithm.mockResolvedValueOnce(buildAlgorithmPayload({
      memories: [
        {
          id: 'memory-six-pack',
          text: 'i\u2019m trying to get a six pack',
          source: 'user',
          ai_usable: true,
          can_edit: true,
          tags: ['coach-chat', 'note'],
        },
      ],
    }));

    await act(async () => {
      tree.update(<AlgorithmHomeScreen accessToken="token-123" memoryRefreshToken={1} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getMyAlgorithm).toHaveBeenCalledTimes(2);
    expect(readNodeText(tree.root)).toContain('i\u2019m trying to get a six pack');
    expect(tree.root.findByProps({ testID: 'algorithm-memory-pill-memory-six-pack' })).toBeTruthy();
  });

  it('edits memory facts inline and keeps meta labels clean', async () => {
    const tree = await renderScreen(buildAlgorithmPayload({
      memories: [
        {
          id: 'memory-1',
          text: 'Prefers morning workouts',
          source: 'user',
          ai_usable: true,
          can_edit: true,
          tags: ['schedule'],
        },
      ],
    }));
    updateMyMemory.mockResolvedValueOnce(buildAlgorithmPayload({
      memories: [
        {
          id: 'memory-1',
          text: 'Prefers outdoor morning workouts',
          source: 'user',
          ai_usable: true,
          can_edit: true,
          tags: ['schedule'],
        },
      ],
    }));

    expect(readNodeText(tree.root)).not.toContain('AI usable');
    expect(tree.root.findAllByProps({ testID: 'algorithm-memory-sheet' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'algorithm-memory-manage-toggle' })).toHaveLength(0);
    expect(tree.root.findByProps({ testID: 'algorithm-memory-management-hint' })).toBeTruthy();

    await act(async () => {
      tree.root.findByProps({ testID: 'algorithm-memory-pill-memory-1' }).props.onPress();
    });

    expect(findPressableByTestID(tree.root, 'algorithm-memory-save')).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'algorithm-memory-input' }).props.value).toBe('Prefers morning workouts');
    await act(async () => {
      tree.root.findByProps({ testID: 'algorithm-memory-input' }).props.onChangeText('Prefers outdoor morning workouts');
    });
    await act(async () => {
      findPressableByTestID(tree.root, 'algorithm-memory-save').props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(updateMyMemory).toHaveBeenCalledWith({
      accessToken: 'token-123',
      memoryId: 'memory-1',
      text: 'Prefers outdoor morning workouts',
      category: null,
      aiUsable: true,
      tags: ['schedule'],
    });
    expect(tree.root.findAllByProps({ testID: 'algorithm-memory-input' })).toHaveLength(0);
    expect(readNodeText(tree.root)).toContain('Prefers outdoor morning workouts');
  });

  it('adds a new fact inline through the existing API', async () => {
    const tree = await renderScreen();
    createMyMemory.mockResolvedValueOnce(buildAlgorithmPayload({
      memories: [
        {
          id: 'memory-new',
          text: 'Needs a low-friction evening option',
          source: 'user',
          ai_usable: true,
          can_edit: true,
          tags: [],
        },
      ],
    }));

    await act(async () => {
      findPressableByTestID(tree.root, 'algorithm-add-memory').props.onPress();
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'algorithm-memory-input' }).props.onChangeText('Needs a low-friction evening option');
    });
    await act(async () => {
      findPressableByTestID(tree.root, 'algorithm-memory-save').props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(createMyMemory).toHaveBeenCalledWith({
      accessToken: 'token-123',
      text: 'Needs a low-friction evening option',
      category: null,
      aiUsable: true,
      tags: [],
    });
    expect(readNodeText(tree.root)).toContain('Needs a low-friction evening option');
    expect(tree.root.findAllByProps({ testID: 'algorithm-memory-sheet' })).toHaveLength(0);
  });

  it('deletes editable memories through the API and removes them from the home state', async () => {
    const tree = await renderScreen(buildAlgorithmPayload({
      memories: [
        {
          id: 'memory-1',
          text: 'Prefers morning workouts',
          source: 'user',
          ai_usable: true,
          can_edit: true,
          tags: ['schedule'],
        },
      ],
    }));
    deleteMyMemory.mockResolvedValueOnce(buildAlgorithmPayload({ memories: [] }));

    expect(tree.root.findAllByProps({ testID: 'algorithm-memory-manage-toggle' })).toHaveLength(0);
    expect(tree.root.findByProps({ testID: 'algorithm-memory-management-hint' })).toBeTruthy();

    await act(async () => {
      tree.root.findByProps({ testID: 'algorithm-memory-pill-memory-1' }).props.onLongPress();
    });
    await act(async () => {
      findPressableByTestID(tree.root, 'algorithm-memory-delete').props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(deleteMyMemory).toHaveBeenCalledWith({
      accessToken: 'token-123',
      memoryId: 'memory-1',
    });
    expect(tree.root.findAllByProps({ testID: 'algorithm-memory-pill-memory-1' })).toHaveLength(0);
    expect(readNodeText(tree.root)).toContain('Fact deleted.');
  });

  it('restores a memory chip and shows the backend error when delete verification fails', async () => {
    const tree = await renderScreen(buildAlgorithmPayload({
      memories: [
        {
          id: 'memory-1',
          text: 'Prefers morning workouts',
          source: 'user',
          ai_usable: true,
          can_edit: true,
          tags: ['schedule'],
        },
      ],
    }));
    deleteMyMemory.mockRejectedValueOnce(new Error('Memory could not be verified after deleting. Please retry.'));

    await act(async () => {
      tree.root.findByProps({ testID: 'algorithm-memory-pill-memory-1' }).props.onLongPress();
    });
    await act(async () => {
      findPressableByTestID(tree.root, 'algorithm-memory-delete').props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(deleteMyMemory).toHaveBeenCalledWith({
      accessToken: 'token-123',
      memoryId: 'memory-1',
    });
    expect(tree.root.findByProps({ testID: 'algorithm-memory-pill-memory-1' })).toBeTruthy();
    expect(readNodeText(tree.root)).toContain('Memory could not be verified after deleting. Please retry.');
  });
});

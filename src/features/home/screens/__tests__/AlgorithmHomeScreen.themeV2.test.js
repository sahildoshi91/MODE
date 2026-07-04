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

let mockThemeV2Enabled = false;
jest.mock('../../../../config/featureFlags', () => ({
  get THEME_V2_ENABLED() {
    return mockThemeV2Enabled;
  },
}));

import React from 'react';
import { StyleSheet } from 'react-native';
import renderer, { act } from 'react-test-renderer';

import AlgorithmHomeScreen from '../AlgorithmHomeScreen';
import { theme, themeV2Modes, themeV2Tokens } from '../../../../../lib/theme';
import { getMyAlgorithm } from '../../services/algorithmApi';

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

function buildMemoryPayload() {
  return buildAlgorithmPayload({
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
  });
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

function unmountCurrentTree() {
  if (currentTree) {
    act(() => {
      currentTree.unmount();
    });
    currentTree = null;
  }
}

function findByTestIDWithProp(root, testID, propName) {
  const matches = root.findAll((node) => (
    node.props?.testID === testID && node.props?.[propName] !== undefined
  ));
  if (matches.length < 1) {
    throw new Error(`Expected a node with testID ${testID} and prop ${propName}`);
  }
  return matches[0];
}

function flattenedStyle(root, testID) {
  return StyleSheet.flatten(findByTestIDWithProp(root, testID, 'style').props.style);
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

describe('AlgorithmHomeScreen theme v2 pilot', () => {
  beforeEach(() => {
    mockThemeV2Enabled = false;
  });

  afterEach(() => {
    unmountCurrentTree();
    jest.clearAllMocks();
  });

  it('renders the v1 mode theme when the flag is off', async () => {
    const tree = await renderScreen(buildAlgorithmPayload(), { currentMode: 'BEAST' });

    expect(flattenedStyle(tree.root, 'algorithm-home-mode-label').color)
      .toBe(theme.modes.beast.accentStrong);
    expect(findByTestIDWithProp(tree.root, 'algorithm-why-card', 'fillColor').props.fillColor)
      .toBe(theme.modes.beast.cardFill);
    expect(findByTestIDWithProp(tree.root, 'algorithm-add-memory', 'fillColor').props.fillColor)
      .toBe(theme.memoryChip.fillActive);
  });

  it('applies the v2 accent and surfaces when the flag is on with a valid mode', async () => {
    mockThemeV2Enabled = true;
    const tree = await renderScreen(buildAlgorithmPayload(), {
      currentMode: 'BEAST',
      readinessScore: 20,
    });

    expect(flattenedStyle(tree.root, 'algorithm-home-mode-label').color)
      .toBe(themeV2Modes.beast.accent);
    expect(flattenedStyle(tree.root, 'algorithm-home-readiness-score').color)
      .toBe(themeV2Tokens.text.secondary);

    const whyCard = findByTestIDWithProp(tree.root, 'algorithm-why-card', 'fillColor');
    expect(whyCard.props.fillColor).toBe(themeV2Tokens.surfaces.surface2.fill);
    expect(whyCard.props.borderColor).toBe(themeV2Tokens.surfaces.surface2.border);
    expect(whyCard.props.accentColor).toBe(themeV2Modes.beast.accent);

    const addMemory = findByTestIDWithProp(tree.root, 'algorithm-add-memory', 'fillColor');
    expect(addMemory.props.fillColor).toBe(themeV2Tokens.surfaces.surface1.fill);
    expect(addMemory.props.borderColor).toBe(themeV2Tokens.surfaces.surface1.border);
  });

  it('normalizes lowercase and padded mode values end to end', async () => {
    mockThemeV2Enabled = true;
    const tree = await renderScreen(buildAlgorithmPayload(), { currentMode: ' beast ' });

    expect(flattenedStyle(tree.root, 'algorithm-home-mode-label').color)
      .toBe(themeV2Modes.beast.accent);
  });

  it.each([[null], ['GARBAGE']])(
    'renders identically to flag off when the flag is on with mode %j',
    async (mode) => {
      const offTree = await renderScreen(buildAlgorithmPayload(), { currentMode: mode });
      // JSON.stringify drops function props, whose identities legitimately
      // differ between two renders; everything visual must match exactly.
      const offSerialized = JSON.stringify(offTree.toJSON());
      unmountCurrentTree();
      jest.clearAllMocks();

      mockThemeV2Enabled = true;
      const onTree = await renderScreen(buildAlgorithmPayload(), { currentMode: mode });

      expect(JSON.stringify(onTree.toJSON())).toBe(offSerialized);
    },
  );

  it('uses the canonical opaque surface3 for the editor and flips via the dev toggle', async () => {
    mockThemeV2Enabled = true;
    const tree = await renderScreen(buildMemoryPayload(), { currentMode: 'BUILD' });

    await act(async () => {
      tree.root.findByProps({ testID: 'algorithm-memory-pill-memory-1' }).props.onPress();
    });

    let editor = findByTestIDWithProp(tree.root, 'algorithm-memory-editor-memory-1', 'fillColor');
    expect(editor.props.fillColor).toBe(themeV2Tokens.surfaces.surface3Opaque.fill);
    expect(editor.props.borderColor).toBe(themeV2Tokens.surfaces.surface3Opaque.border);

    const toggle = tree.root.findAll((node) => (
      node.props?.testID === 'algorithm-elevation-model-toggle'
      && typeof node.props?.onLongPress === 'function'
    ))[0];
    await act(async () => {
      toggle.props.onLongPress();
    });

    editor = findByTestIDWithProp(tree.root, 'algorithm-memory-editor-memory-1', 'fillColor');
    expect(editor.props.fillColor).toBe(themeV2Tokens.surfaces.surface3Overlay.fill);
    expect(editor.props.borderColor).toBe(themeV2Tokens.surfaces.surface3Overlay.border);
  });
});

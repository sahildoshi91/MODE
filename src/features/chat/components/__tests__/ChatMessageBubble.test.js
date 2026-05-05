import React from 'react';
import { Text } from 'react-native';
import renderer, { act } from 'react-test-renderer';

const mockAIResponseRenderer = jest.fn();
const mockSetStringAsync = jest.fn();

jest.mock('expo-clipboard', () => ({
  setStringAsync: (...args) => mockSetStringAsync(...args),
}));

jest.mock('expo-blur', () => ({
  BlurView: ({ children, ...props }) => {
    const React = require('react');
    const { View } = require('react-native');
    return React.createElement(View, props, children);
  },
}));

jest.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children, ...props }) => {
    const React = require('react');
    const { View } = require('react-native');
    return React.createElement(View, props, children);
  },
}));

jest.mock('../AIResponseRenderer', () => {
  return function MockAIResponseRenderer(props) {
    const React = require('react');
    const { Text } = require('react-native');
    mockAIResponseRenderer(props);
    return React.createElement(Text, { testID: 'mock-ai-response-renderer' }, 'structured');
  };
});

import ChatMessageBubble from '../ChatMessageBubble';

function collectRenderedText(root) {
  return root
    .findAllByType(Text)
    .flatMap((node) => {
      const children = node.props?.children;
      if (Array.isArray(children)) {
        return children.filter((child) => typeof child === 'string');
      }
      return typeof children === 'string' ? [children] : [];
    })
    .join(' ');
}

describe('ChatMessageBubble', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSetStringAsync.mockResolvedValue(undefined);
  });

  it('renders auto-generated opening summaries as plain text', () => {
    const staleOpeningText = (
      'MODE: YELLOW, 19/25. Recovery-leaning day. Training: 20-30 min, Low, Light movement or recovery. '
      + 'Nutrition: Protein steady, easy whole-food meals, hydrate first. '
      + 'Mindset: Recovery done well is progress. Build Today: tap training routine or nutrition plan.'
    );
    let tree;

    act(() => {
      tree = renderer.create(
        <ChatMessageBubble
          message={{
            id: 'opening-1',
            role: 'assistant',
            text: staleOpeningText,
            metadata: {
              auto_generated_opening_summary: true,
            },
          }}
        />,
      );
    });

    expect(mockAIResponseRenderer).not.toHaveBeenCalled();
    expect(tree.root.findAllByProps({ testID: 'mock-ai-response-renderer' })).toHaveLength(0);
    const renderedText = collectRenderedText(tree.root);
    expect(renderedText).toContain('BUILD MODE');
    expect(renderedText).toContain('Stable readiness.');
    expect(renderedText).toContain('30-45 min, Moderate, Moderate cardio or controlled strength.');
    expect(renderedText).toContain('Protein each meal, balanced carbs, intentional snacks.');
    expect(renderedText).toContain('Build momentum with disciplined reps.');
    expect(renderedText).toContain('What do you want to achieve today?');
    expect(renderedText).not.toContain('YELLOW');
    expect(renderedText).not.toContain('Build Today:');
    expect(renderedText).not.toContain('Protein steady');
    expect(tree.root.find((node) => (
      node.type === Text
      && node.props?.children === 'BUILD MODE'
      && node.props?.style?.fontWeight === '800'
    ))).toBeTruthy();
    ['Training', 'Nutrition', 'Mindset'].forEach((label) => {
      expect(tree.root.find((node) => (
        node.type === Text
        && node.props?.children === label
        && node.props?.style?.fontWeight === '800'
      ))).toBeTruthy();
    });

    act(() => {
      tree.unmount();
    });
  });

  it('keeps structured rendering available for ordinary assistant messages', () => {
    let tree;

    act(() => {
      tree = renderer.create(
        <ChatMessageBubble
          message={{
            id: 'assistant-1',
            role: 'assistant',
            text: [
              'Greek Yogurt Parfait: Plain Greek yogurt with berries.',
              'Tofu Scramble: Savory scramble with spinach.',
            ].join('\n'),
          }}
        />,
      );
    });

    expect(mockAIResponseRenderer).toHaveBeenCalledTimes(1);

    act(() => {
      tree.unmount();
    });
  });

  it('keeps optimistic opening copy as plain streaming text', () => {
    let tree;

    act(() => {
      tree = renderer.create(
        <ChatMessageBubble
          message={{
            id: 'optimistic-opening-summary',
            role: 'assistant',
            text: "Hey, I'm pulling in today's MODE now.",
            isStreaming: true,
            metadata: {
              optimistic_opening_summary: true,
            },
          }}
        />,
      );
    });

    const optimisticTextNode = tree.root.find((node) => (
      node.type === Text
      && node.props?.children === "Hey, I'm pulling in today's MODE now."
    ));
    expect(optimisticTextNode.props?.style?.fontWeight).not.toBe('800');
    expect(tree.root.findAll((node) => (
      node.type === Text
      && node.props?.children === "Hey, I'm pulling in today's MODE now."
      && node.props?.style?.fontWeight === '800'
    ))).toHaveLength(0);

    act(() => {
      tree.unmount();
    });
  });

  it('copies coach messages on long press', async () => {
    let tree;

    await act(async () => {
      tree = renderer.create(
        <ChatMessageBubble
          message={{
            id: 'assistant-copy',
            role: 'assistant',
            text: 'Coach copy text',
          }}
        />,
      );
    });

    const longPressTarget = tree.root.findAll((node) => typeof node.props?.onLongPress === 'function')[0];
    await act(async () => {
      await longPressTarget.props.onLongPress();
    });

    expect(mockSetStringAsync).toHaveBeenCalledWith('Coach copy text');
    expect(collectRenderedText(tree.root)).toContain('Copied');

    act(() => {
      tree.unmount();
    });
  });
});

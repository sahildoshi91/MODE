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

jest.mock('lucide-react-native', () => ({
  ChevronDown: (props) => {
    const React = require('react');
    const { Text } = require('react-native');
    return React.createElement(Text, props, 'chevron-down');
  },
  ChevronUp: (props) => {
    const React = require('react');
    const { Text } = require('react-native');
    return React.createElement(Text, props, 'chevron-up');
  },
  Copy: (props) => {
    const React = require('react');
    const { Text } = require('react-native');
    return React.createElement(Text, props, 'copy');
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

function findLongPressTargetByText(root, text) {
  return root.findAll((node) => (
    typeof node.props?.onLongPress === 'function'
    && collectRenderedText(node).includes(text)
  )).sort((left, right) => collectRenderedText(left).length - collectRenderedText(right).length)[0];
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

  it('renders structured check-in response sections for opening summaries', () => {
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
            id: 'opening-structured-1',
            role: 'assistant',
            text: staleOpeningText,
            metadata: {
              auto_generated_opening_summary: true,
              summary_source: 'client_daily_checkin_response_v1',
              checkin_response: {
                mode: 'BUILD',
                total_score: 20,
                generated_at: '2026-05-30T16:00:00+00:00',
                model_used: 'gpt-5.4-mini',
                sections: [
                  {
                    id: 'opening',
                    label: null,
                    content: 'Build day - 20/25. Motivation is high, and your body is ready for steady work.',
                  },
                  {
                    id: 'workout',
                    label: "Today's workout",
                    content: 'Use three controlled strength rounds where every rep stays clean.',
                  },
                  {
                    id: 'nutrition',
                    label: 'Before you train',
                    content: 'Eat Greek yogurt with berries or eggs and toast, then hydrate before the session.',
                  },
                  {
                    id: 'why',
                    label: 'Your why',
                    content: 'This is the kind of repeatable effort that gives you more energy at home.',
                  },
                  {
                    id: 'question',
                    label: null,
                    content: 'Which movement do you want to build the session around?',
                  },
                ],
              },
            },
          }}
        />,
      );
    });

    expect(mockAIResponseRenderer).not.toHaveBeenCalled();
    expect(tree.root.findByProps({ testID: 'structured-opening-summary' })).toBeTruthy();
    const renderedText = collectRenderedText(tree.root);
    expect(renderedText).toContain('BUILD MODE');
    expect(renderedText).toContain('Build day - 20/25. Motivation is high');
    expect(renderedText).toContain("Today's workout");
    expect(renderedText).toContain('Use three controlled strength rounds');
    expect(renderedText).toContain('Before you train');
    expect(renderedText).toContain('Greek yogurt with berries');
    expect(renderedText).toContain('Your why');
    expect(renderedText).toContain('Which movement do you want to build the session around?');
    expect(renderedText).not.toContain('Stable readiness.');
    expect(renderedText).not.toContain('30-45 min, Moderate');
    expect(renderedText).not.toContain('Build momentum with disciplined reps.');
    expect(renderedText).not.toContain('Recovery-leaning day.');
    expect(renderedText).not.toContain('Protein steady');

    act(() => {
      tree.unmount();
    });
  });

  it('renders unstructured trainer opening summaries as body text', () => {
    const trainerOpeningText = (
      'You have 1 clients on the board today, with 0 missed check-ins and 0 showing low recovery patterns. '
      + 'Best move: review flagged clients before pushing new programming. '
      + 'Start with the highest priority client first. Want to start with the highest priority?'
    );
    let tree;

    act(() => {
      tree = renderer.create(
        <ChatMessageBubble
          message={{
            id: 'trainer-opening-1',
            role: 'assistant',
            text: trainerOpeningText,
            metadata: {
              auto_generated_opening_summary: true,
            },
          }}
        />,
      );
    });

    expect(mockAIResponseRenderer).not.toHaveBeenCalled();
    const trainerTextNode = tree.root.find((node) => (
      node.type === Text
      && node.props?.children === trainerOpeningText
    ));
    expect(trainerTextNode.props?.style?.fontWeight).toBeUndefined();
    expect(trainerTextNode.props?.style?.fontSize).toBe(16);
    expect(tree.root.findAll((node) => (
      node.type === Text
      && node.props?.children === trainerOpeningText
      && node.props?.style?.fontWeight === '800'
    ))).toHaveLength(0);

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

  it('renders flagged-client review metadata as compact cards', async () => {
    let tree;

    await act(async () => {
      tree = renderer.create(
        <ChatMessageBubble
          message={{
            id: 'flagged-review-1',
            role: 'assistant',
            text: 'Taylor — High\n\nMain issue:\nAdherence is breaking down.',
            metadata: {
              flagged_client_review_v3: {
                version: 3,
                cards: [{
                  client_id: 'client-1',
                  client_name: 'Taylor',
                  priority: 'High',
                  primary_issue_type: 'adherence_collapse',
                  action_signal: {
                    label: 'Reduce Friction',
                    tone: 'high',
                  },
                  main_issue: 'Adherence is breaking down, not just training volume.',
                  why_it_matters: 'Low motivation plus missed training can become disengagement.',
                  next_action: 'Remove friction and assign one easy training win today.',
                  discussion_prompt: "What is blocking workouts right now? Let's make today's win small.",
                  client_message: "What is blocking workouts right now? Let's make today's win small.",
                  metrics_breakdown: [
                    {
                      domain: 'Workouts',
                      signal: 'Training follow-through is low.',
                      coaching_meaning: 'The plan likely needs less friction before more volume.',
                      detail: 'Set one small session target today.',
                    },
                    {
                      domain: 'Motivation',
                      signal: 'Motivation is low.',
                      coaching_meaning: 'The current plan may feel too hard, irrelevant, or blocked.',
                      detail: 'Ask for the blocker before changing the program.',
                    },
                  ],
                  metrics_summary: [
                    'low training follow-through',
                    'motivation is low',
                  ],
                }],
              },
            },
          }}
        />,
      );
    });

    expect(mockAIResponseRenderer).not.toHaveBeenCalled();
    expect(tree.root.findByProps({ testID: 'flagged-client-review-root' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'flagged-client-review-card-0' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'flagged-client-review-action-signal-0' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'flagged-client-review-next-action-0' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'flagged-client-review-discussion-cue-0' })).toBeTruthy();
    expect(() => tree.root.findByProps({ testID: 'flagged-client-review-metrics-panel-0' })).toThrow();

    await act(async () => {
      tree.root.findByProps({ testID: 'flagged-client-review-metrics-toggle-0' }).props.onPress();
    });

    expect(tree.root.findByProps({ testID: 'flagged-client-review-metrics-panel-0' })).toBeTruthy();
    const renderedText = collectRenderedText(tree.root);
    expect(renderedText).toContain('Reduce Friction');
    expect(renderedText).not.toContain('Copy message');
    expect(renderedText).toContain('Next action');
    expect(renderedText).toContain('Remove friction and assign one easy training win today.');
    expect(renderedText).toContain('Discussion cue');
    expect(renderedText).toContain('Workouts');
    expect(renderedText).toContain('The plan likely needs less friction before more volume.');

    await act(async () => {
      await findLongPressTargetByText(
        tree.root,
        'Remove friction and assign one easy training win today.',
      ).props.onLongPress();
    });

    expect(mockSetStringAsync).toHaveBeenCalledWith('Remove friction and assign one easy training win today.');

    await act(async () => {
      await findLongPressTargetByText(
        tree.root,
        "What is blocking workouts right now? Let's make today's win small.",
      ).props.onLongPress();
    });

    expect(mockSetStringAsync).toHaveBeenCalledWith("What is blocking workouts right now? Let's make today's win small.");

    await act(async () => {
      await findLongPressTargetByText(
        tree.root,
        'The plan likely needs less friction before more volume.',
      ).props.onLongPress();
    });

    expect(mockSetStringAsync).toHaveBeenCalledWith(
      'Workouts: Training follow-through is low. The plan likely needs less friction before more volume. Set one small session target today.',
    );
    expect(collectRenderedText(tree.root)).toContain('Copied');

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

  it('copies user messages on long press', async () => {
    let tree;

    await act(async () => {
      tree = renderer.create(
        <ChatMessageBubble
          message={{
            id: 'user-copy',
            role: 'user',
            text: 'Can you review flagged clients?',
          }}
        />,
      );
    });

    const longPressTarget = tree.root.findAll((node) => typeof node.props?.onLongPress === 'function')[0];
    await act(async () => {
      await longPressTarget.props.onLongPress();
    });

    expect(mockSetStringAsync).toHaveBeenCalledWith('Can you review flagged clients?');
    expect(collectRenderedText(tree.root)).toContain('Copied');

    act(() => {
      tree.unmount();
    });
  });
});

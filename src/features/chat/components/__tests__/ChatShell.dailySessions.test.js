import React from 'react';
import { Modal, Text, View } from 'react-native';
import renderer, { act } from 'react-test-renderer';

const mockGetTodayChatSession = jest.fn();
const mockGetChatSession = jest.fn();
const mockContinueChatSession = jest.fn();
const mockListChatSessions = jest.fn();
const mockSendChatSessionMessage = jest.fn();
const mockStreamChatSessionMessage = jest.fn();

jest.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children, ...props }) => {
    const React = require('react');
    const { View } = require('react-native');
    return React.createElement(View, props, children);
  },
}));

jest.mock('lucide-react-native', () => ({
  History: (props) => {
    const React = require('react');
    const { Text } = require('react-native');
    return React.createElement(Text, props, 'history');
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }) => children,
  SafeAreaView: ({ children, ...props }) => {
    const React = require('react');
    const { View } = require('react-native');
    return React.createElement(View, props, children);
  },
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../services/chatSessionService', () => ({
  CHAT_SESSIONS_BASE_PATH: '/api/v1/chat/sessions',
  getLocalDateString: () => '2026-05-03',
  getTodayChatSession: (...args) => mockGetTodayChatSession(...args),
  getChatSession: (...args) => mockGetChatSession(...args),
  continueChatSession: (...args) => mockContinueChatSession(...args),
  listChatSessions: (...args) => mockListChatSessions(...args),
}));

jest.mock('../../services/chatMessageService', () => ({
  sendChatSessionMessage: (...args) => mockSendChatSessionMessage(...args),
  streamChatSessionMessage: (...args) => mockStreamChatSessionMessage(...args),
}));

jest.mock('../ChatMessageBubble', () => {
  return function MockChatMessageBubble({ message }) {
    const React = require('react');
    const { Text } = require('react-native');
    return React.createElement(Text, { testID: `bubble-${message.id}` }, message.text);
  };
});

import ChatHistoryButton from '../ChatHistoryButton';
import ChatInputDock from '../ChatInputDock';
import ChatMessageList from '../ChatMessageList';
import ChatShell from '../ChatShell';
import StreamingAIMessage from '../StreamingAIMessage';

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return {
    promise,
    resolve,
    reject,
  };
}

const openingMessage = {
  id: 'opening-1',
  role: 'assistant',
  text: 'Your recovery looks solid today. What gets done first?',
  content: 'Your recovery looks solid today. What gets done first?',
  metadata: {
    auto_generated_opening_summary: true,
    suggested_action_chips: ['Finish a workout', 'Reach step goal'],
  },
};

describe('daily chat session components', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockGetTodayChatSession.mockResolvedValue({
      session: {
        id: 'session-today',
        session_date: '2026-05-03',
        title: 'Today',
      },
      messages: [openingMessage],
      suggested_actions: ['Finish a workout', 'Reach step goal'],
      read_only: false,
    });
    mockListChatSessions.mockResolvedValue({
      sessions: [],
    });
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it('ChatHistoryButton invokes navigation instead of opening a modal', () => {
    const onPress = jest.fn();
    let tree;

    act(() => {
      tree = renderer.create(<ChatHistoryButton onPress={onPress} />);
    });

    act(() => {
      tree.root.findByProps({ testID: 'chat-history-button' }).props.onPress();
    });

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(tree.root.findAllByType(Modal)).toHaveLength(0);
    act(() => {
      tree.unmount();
    });
  });

  it('pushes ChatHistoryScreen from the shell history button', async () => {
    let tree;

    await act(async () => {
      tree = renderer.create(
        <ChatShell
          role="client"
          sessionType="client_chat"
          trainerId="trainer-1"
          accessToken="token"
        />,
      );
    });
    await flushEffects();

    await act(async () => {
      tree.root.findByProps({ testID: 'chat-history-button' }).props.onPress();
    });

    expect(tree.root.findByProps({ testID: 'chat-history-screen' })).toBeTruthy();
    expect(tree.root.findAllByType(Modal)).toHaveLength(0);
    act(() => {
      tree.unmount();
    });
  });

  it('renders an optimistic AI bubble immediately before today session resolves', async () => {
    const deferred = createDeferred();
    mockGetTodayChatSession.mockReturnValueOnce(deferred.promise);
    let tree;

    await act(async () => {
      tree = renderer.create(
        <ChatShell
          role="client"
          sessionType="client_chat"
          trainerId="trainer-1"
          accessToken="token"
          currentMode="BUILD"
        />,
      );
    });

    expect(tree.root.findByProps({ testID: 'bubble-optimistic-opening-summary' })).toBeTruthy();

    await act(async () => {
      deferred.resolve({
        session: {
          id: 'session-today',
          session_date: '2026-05-03',
          title: 'Today',
        },
        messages: [openingMessage],
        suggested_actions: ['Finish a workout'],
        read_only: false,
      });
      await Promise.resolve();
    });

    act(() => {
      tree.unmount();
    });
  });

  it('replaces optimistic opening with the persisted server opening', async () => {
    let tree;

    await act(async () => {
      tree = renderer.create(
        <ChatShell
          role="client"
          sessionType="client_chat"
          trainerId="trainer-1"
          accessToken="token"
        />,
      );
    });
    await flushEffects();

    expect(tree.root.findAllByProps({ testID: 'bubble-optimistic-opening-summary' })).toHaveLength(0);
    expect(tree.root.findByProps({ testID: 'bubble-opening-1' }).props.children)
      .toBe(openingMessage.text);
    act(() => {
      tree.unmount();
    });
  });

  it('shows route-not-found recovery copy instead of silent loading', async () => {
    const error = new Error('Coach session is not available on this backend yet.');
    error.status = 404;
    error.code = 'CHAT_SESSIONS_ROUTE_NOT_FOUND';
    error.request_path = '/api/v1/chat/sessions/today';
    error.api_base_url = 'http://127.0.0.1:8000';
    mockGetTodayChatSession.mockRejectedValueOnce(error);
    let tree;

    await act(async () => {
      tree = renderer.create(
        <ChatShell
          role="client"
          sessionType="client_chat"
          trainerId="trainer-1"
          accessToken="token"
        />,
      );
    });
    await flushEffects();

    expect(tree.root.findAllByProps({ testID: 'bubble-optimistic-opening-summary' })).toHaveLength(0);
    expect(tree.root.findByProps({ testID: 'chat-session-retry-button' })).toBeTruthy();
    const recoveryText = tree.root.findAll((node) => (
      node.type === Text && node.props?.children === 'Coach session is not available on this backend yet.'
    ));
    expect(recoveryText).toHaveLength(1);
    act(() => {
      tree.unmount();
    });
  });

  it('shows migration-specific recovery copy for missing chat session storage', async () => {
    const error = new Error('Chat session storage is not migrated on this backend yet.');
    error.status = 503;
    error.code = 'CHAT_SESSION_SCHEMA_MISSING';
    error.hint = 'Run the chat sessions migration and reload the Supabase schema cache.';
    error.request_path = '/api/v1/chat/sessions/today';
    error.api_base_url = 'http://127.0.0.1:8000';
    mockGetTodayChatSession.mockRejectedValueOnce(error);
    let tree;

    await act(async () => {
      tree = renderer.create(
        <ChatShell
          role="client"
          sessionType="client_chat"
          trainerId="trainer-1"
          accessToken="token"
        />,
      );
    });
    await flushEffects();

    expect(tree.root.findAllByProps({ testID: 'bubble-optimistic-opening-summary' })).toHaveLength(0);
    expect(tree.root.findByProps({ testID: 'chat-session-retry-button' })).toBeTruthy();
    const recoveryText = tree.root.findAll((node) => (
      node.type === Text && node.props?.children === 'Chat session storage is not migrated on this backend yet.'
    ));
    expect(recoveryText).toHaveLength(1);
    const hintText = tree.root.findAll((node) => (
      node.type === Text && node.props?.children === 'Run the chat sessions migration and reload the Supabase schema cache.'
    ));
    expect(hintText).toHaveLength(1);
    act(() => {
      tree.unmount();
    });
  });

  it('renders the opening summary chips once', () => {
    let tree;

    act(() => {
      tree = renderer.create(
        <ChatMessageList
          messages={[openingMessage]}
          suggestedActions={['Finish a workout', 'Reach step goal']}
          onSelectSuggestedAction={jest.fn()}
        />,
      );
    });

    const chipContainers = tree.root.findAll((node) => (
      node.type === View && node.props?.testID === 'suggested-action-chips'
    ));
    expect(chipContainers).toHaveLength(1);
    expect(tree.root.findAllByProps({ children: 'Finish a workout' }).length).toBeGreaterThan(0);
    act(() => {
      tree.unmount();
    });
  });

  it('does not animate historical AI messages', () => {
    let tree;

    act(() => {
      tree = renderer.create(
        <StreamingAIMessage
          message={{
            id: 'history-ai',
            role: 'assistant',
            text: 'Historical response',
            animate: false,
          }}
        />,
      );
    });

    expect(tree.root.findByProps({ testID: 'bubble-history-ai' }).props.children)
      .toBe('Historical response');
    act(() => {
      tree.unmount();
    });
  });

  it('disables the composer for read-only history', () => {
    let tree;

    act(() => {
      tree = renderer.create(
        <ChatInputDock
          readOnly
          onSend={jest.fn()}
        />,
      );
    });

    expect(tree.root.findByProps({ testID: 'chat-input-dock-readonly' })).toBeTruthy();
    expect(tree.root.findAllByProps({ accessibilityLabel: 'Send message' })).toHaveLength(0);
    act(() => {
      tree.unmount();
    });
  });
});

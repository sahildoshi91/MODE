import React from 'react';
import { Modal, Text, View } from 'react-native';
import renderer, { act } from 'react-test-renderer';

const mockGetTodayChatSession = jest.fn();
const mockGetChatSession = jest.fn();
const mockContinueChatSession = jest.fn();
const mockListChatSessions = jest.fn();
const mockSendChatSessionMessage = jest.fn();
const mockStreamChatSessionMessage = jest.fn();
const mockCheckinPlanBuilder = jest.fn();
const mockDailyCheckinScreen = jest.fn();
const mockCreateMyMemory = jest.fn();

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

jest.mock('../../../home/services/algorithmApi', () => ({
  createMyMemory: (...args) => mockCreateMyMemory(...args),
}));

jest.mock('../../../dailyCheckin/screens/DailyCheckinScreen', () => ({
  __esModule: true,
  default: (props) => {
    const React = require('react');
    const { Text } = require('react-native');
    mockDailyCheckinScreen(props);
    return React.createElement(
      Text,
      { testID: 'daily-checkin-screen', onPress: props.onCheckinComplete },
      'daily-checkin',
    );
  },
  CHECKIN_PLAN_TYPE: {
    TRAINING: 'training',
    NUTRITION: 'nutrition',
  },
  CheckinPlanBuilder: (props) => {
    const React = require('react');
    const { Text } = require('react-native');
    mockCheckinPlanBuilder(props);
    return React.createElement(Text, { testID: 'checkin-plan-builder' }, `plan-${props.initialPlanType}`);
  },
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
  text: 'BUILD MODE\n20/25. Stable readiness.\nTraining: 30-45 min, Moderate, controlled strength.\nNutrition: Protein each meal.\nMindset: Build momentum.\n\nWhat do you want to achieve today?',
  content: 'BUILD MODE\n20/25. Stable readiness.\nTraining: 30-45 min, Moderate, controlled strength.\nNutrition: Protein each meal.\nMindset: Build momentum.\n\nWhat do you want to achieve today?',
  metadata: {
    auto_generated_opening_summary: true,
    suggested_action_chips: ['Build me a training routine', 'Build me a nutrition plan'],
  },
};

function mockSuccessfulCoachStream(responseText = 'Saved. I will keep that in mind.') {
  mockStreamChatSessionMessage.mockImplementationOnce(async ({
    message,
    clientMessageId,
    onEvent,
  }) => {
    onEvent?.({
      type: 'start',
      user_message: {
        id: `backend-${clientMessageId || 'user'}`,
        sender_type: 'user',
        content: message,
        message_index: 1,
        metadata: {
          client_message_id: clientMessageId,
          idempotency_key: clientMessageId,
        },
      },
    });
    onEvent?.({
      type: 'completed',
      assistant_message: responseText,
      ai_message: {
        id: `ai-${clientMessageId || 'message'}`,
        sender_type: 'ai',
        content: responseText,
        message_index: 2,
        metadata: {},
      },
    });
  });
}

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
      suggested_actions: ['Build me a training routine', 'Build me a nutrition plan'],
      read_only: false,
    });
    mockListChatSessions.mockResolvedValue({
      sessions: [],
    });
    mockCreateMyMemory.mockResolvedValue({ memories: [] });
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
          currentMode="YELLOW"
        />,
      );
    });

    for (let step = 0; step < 20; step += 1) {
      await act(async () => {
        jest.runOnlyPendingTimers();
        await Promise.resolve();
      });
    }

    const optimisticBubble = tree.root.findByProps({ testID: 'bubble-optimistic-opening-summary' });
    expect(optimisticBubble).toBeTruthy();
    expect(optimisticBubble.props.children).toContain('current MODE is BUILD');
    expect(optimisticBubble.props.children).not.toContain('YELLOW');

    await act(async () => {
      deferred.resolve({
        session: {
          id: 'session-today',
          session_date: '2026-05-03',
          title: 'Today',
        },
        messages: [openingMessage],
        suggested_actions: ['Build me a training routine'],
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
          suggestedActions={['Build me a training routine', 'Build me a nutrition plan']}
          onSelectSuggestedAction={jest.fn()}
        />,
      );
    });

    const chipContainers = tree.root.findAll((node) => (
      node.type === View && node.props?.testID === 'suggested-action-chips'
    ));
    expect(chipContainers).toHaveLength(1);
    expect(tree.root.findAllByProps({ children: openingMessage.text }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ children: 'Build me a training routine' }).length).toBeGreaterThan(0);
    act(() => {
      tree.unmount();
    });
  });

  it('opens native plan builder for plan action chips', async () => {
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

    const chipText = tree.root.findAllByProps({ children: 'Build me a training routine' })[0];
    let chipPressable = chipText;
    while (chipPressable && typeof chipPressable.props?.onPress !== 'function') {
      chipPressable = chipPressable.parent;
    }
    await act(async () => {
      chipPressable.props.onPress();
    });

    expect(tree.root.findByProps({ testID: 'checkin-plan-builder' })).toBeTruthy();
    expect(mockCheckinPlanBuilder).toHaveBeenLastCalledWith(expect.objectContaining({
      initialPlanType: 'training',
    }));
    expect(mockSendChatSessionMessage).not.toHaveBeenCalled();
    act(() => {
      tree.unmount();
    });
  });

  it('opens daily check-in from the Coach action chips', async () => {
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

    const chipText = tree.root.findAllByProps({ children: 'Daily check-in' })[0];
    let chipPressable = chipText;
    while (chipPressable && typeof chipPressable.props?.onPress !== 'function') {
      chipPressable = chipPressable.parent;
    }
    await act(async () => {
      chipPressable.props.onPress();
    });

    expect(tree.root.findByProps({ testID: 'daily-checkin-screen' })).toBeTruthy();
    expect(mockDailyCheckinScreen).toHaveBeenLastCalledWith(expect.objectContaining({
      accessToken: 'token',
      onCheckinComplete: expect.any(Function),
    }));
    expect(mockSendChatSessionMessage).not.toHaveBeenCalled();

    await act(async () => {
      tree.root.findByProps({ testID: 'daily-checkin-screen' }).props.onPress();
      await Promise.resolve();
    });

    expect(mockGetTodayChatSession).toHaveBeenCalledTimes(2);
    act(() => {
      tree.unmount();
    });
  });

  it('saves explicit client memory requests while still sending the chat message', async () => {
    mockSuccessfulCoachStream();
    const onMemorySaved = jest.fn();
    let tree;

    await act(async () => {
      tree = renderer.create(
        <ChatShell
          role="client"
          sessionType="client_chat"
          trainerId="trainer-1"
          accessToken="token"
          onMemorySaved={onMemorySaved}
        />,
      );
    });
    await flushEffects();

    await act(async () => {
      await tree.root.findByType(ChatInputDock).props.onSend('Can you remember that I hate burpees?');
      await Promise.resolve();
    });
    await flushEffects();

    expect(mockCreateMyMemory).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'token',
      text: 'I hate burpees',
      memoryType: 'preference',
      category: 'coach-chat',
      aiUsable: true,
      tags: ['coach-chat', 'preference'],
    }));
    expect(mockStreamChatSessionMessage).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'token',
      message: 'Can you remember that I hate burpees?',
      clientMessageId: expect.any(String),
    }));
    expect(onMemorySaved).toHaveBeenCalledWith(expect.objectContaining({
      intent: expect.objectContaining({
        text: 'I hate burpees',
        memoryType: 'preference',
      }),
      payload: { memories: [] },
    }));
    expect(tree.root.findAll((node) => (
      node.type === Text && node.props?.children === 'Saved to what your coach knows'
    ))).toHaveLength(1);
    act(() => {
      tree.unmount();
    });
  });

  it('shows memory save failure feedback and retries only the memory save', async () => {
    mockCreateMyMemory
      .mockRejectedValueOnce(new Error('Memory route down'))
      .mockResolvedValueOnce({ memories: [] });
    mockSuccessfulCoachStream();
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
      await tree.root.findByType(ChatInputDock).props.onSend('save to memory: my left knee gets sore after lunges');
      await Promise.resolve();
    });
    await flushEffects();

    expect(tree.root.findAll((node) => (
      node.type === Text && node.props?.children === "Couldn't save memory"
    ))).toHaveLength(1);
    expect(mockStreamChatSessionMessage).toHaveBeenCalledTimes(1);

    await act(async () => {
      tree.root.findByProps({ testID: 'chat-memory-status-retry' }).props.onPress();
      await Promise.resolve();
    });
    await flushEffects();

    expect(mockCreateMyMemory).toHaveBeenCalledTimes(2);
    expect(mockStreamChatSessionMessage).toHaveBeenCalledTimes(1);
    expect(tree.root.findAll((node) => (
      node.type === Text && node.props?.children === 'Saved to what your coach knows'
    ))).toHaveLength(1);
    act(() => {
      tree.unmount();
    });
  });

  it('does not duplicate memory saves when a failed chat send is retried', async () => {
    mockCreateMyMemory.mockResolvedValueOnce({ memories: [] });
    mockStreamChatSessionMessage.mockRejectedValueOnce(new Error('stream down'));
    mockSendChatSessionMessage.mockRejectedValueOnce(new Error('send down'));
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
      await tree.root.findByType(ChatInputDock).props.onSend('Please remember that I prefer morning workouts');
      await Promise.resolve();
    });
    await flushEffects();

    mockSuccessfulCoachStream('Morning workouts noted.');
    await act(async () => {
      await tree.root.findByType(ChatInputDock).props.onSend('Please remember that I prefer morning workouts');
      await Promise.resolve();
    });
    await flushEffects();

    expect(mockCreateMyMemory).toHaveBeenCalledTimes(1);
    expect(mockStreamChatSessionMessage).toHaveBeenCalledTimes(2);
    expect(tree.root.findAll((node) => (
      node.type === Text && node.props?.children === 'Saved to what your coach knows'
    )).length).toBeGreaterThanOrEqual(1);
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

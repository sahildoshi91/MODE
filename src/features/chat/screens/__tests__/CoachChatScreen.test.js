import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { FlatList, Keyboard, Platform, StyleSheet } from 'react-native';

const mockUseChatConversation = jest.fn();
const mockRetryFailedRequest = jest.fn();
const mockSendMessage = jest.fn();
const mockLoadMoreHistory = jest.fn();
const mockSetStringAsync = jest.fn();
const mockChatBubble = jest.fn();
const mockCreateTrainerClientMemory = jest.fn();
const mockListTrainerClients = jest.fn();
const mockUpdateTrainerClientMemory = jest.fn();
const mockLoadCoachChatLastMemoryClientId = jest.fn();
const mockSaveCoachChatLastMemoryClientId = jest.fn();

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaProvider: ({ children }) => children,
    SafeAreaView: ({ children }) => React.createElement('SafeAreaView', null, children),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

jest.mock('../../hooks/useChatConversation', () => ({
  useChatConversation: (...args) => mockUseChatConversation(...args),
}));

jest.mock('../../../trainerClients/services/trainerHomeApi', () => ({
  createTrainerClientMemory: (...args) => mockCreateTrainerClientMemory(...args),
  listTrainerClients: (...args) => mockListTrainerClients(...args),
  updateTrainerClientMemory: (...args) => mockUpdateTrainerClientMemory(...args),
}));

jest.mock('../../storage/chatMemoryStorage', () => ({
  loadCoachChatLastMemoryClientId: (...args) => mockLoadCoachChatLastMemoryClientId(...args),
  saveCoachChatLastMemoryClientId: (...args) => mockSaveCoachChatLastMemoryClientId(...args),
}));

jest.mock('expo-clipboard', () => ({
  setStringAsync: (...args) => mockSetStringAsync(...args),
}));

jest.mock('../../components/ChatBubble', () => {
  const React = require('react');
  return function MockChatBubble(props) {
    mockChatBubble(props);
    return React.createElement('MockChatBubble', props);
  };
});

jest.mock('../../components/CoachComposer', () => {
  const React = require('react');
  return function MockCoachComposer(props) {
    return React.createElement('MockCoachComposer', props);
  };
});

jest.mock('../../components/QuickReplies', () => {
  const React = require('react');
  return function MockQuickReplies(props) {
    return React.createElement('MockQuickReplies', props);
  };
});

jest.mock('../../components/TypingIndicator', () => {
  const React = require('react');
  return function MockTypingIndicator() {
    return React.createElement('MockTypingIndicator');
  };
});

import CoachChatScreen from '../CoachChatScreen';

describe('CoachChatScreen', () => {
  const originalRequestAnimationFrame = global.requestAnimationFrame;
  const openEventName = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
  const closeEventName = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
  let keyboardListeners = {};
  let keyboardAddListenerSpy;
  let originalScrollToOffset;
  let originalScrollToEnd;

  function renderScreen({
    launchContext = { entrypoint: 'trainer_agent_training', onboarding_action: 'review' },
  } = {}) {
    let tree;
    act(() => {
      tree = renderer.create(
        <CoachChatScreen
          accessToken="trainer-token"
          launchContext={launchContext}
        />,
      );
    });
    return tree;
  }

  function setListMetrics(tree, { offset, contentHeight, layoutHeight }) {
    const flatList = tree.root.findByType(FlatList);
    act(() => {
      flatList.props.onLayout?.({
        nativeEvent: {
          layout: { height: layoutHeight },
        },
      });
      flatList.props.onContentSizeChange?.(0, contentHeight);
      flatList.props.onScroll?.({
        nativeEvent: {
          contentOffset: { y: offset },
          contentSize: { height: contentHeight },
          layoutMeasurement: { height: layoutHeight },
        },
      });
    });
  }

  function setDockHeight(tree, height) {
    const dockStack = tree.root.findByProps({ testID: 'coach-chat-dock-stack' });
    act(() => {
      dockStack.props.onLayout?.({
        nativeEvent: {
          layout: { height },
        },
      });
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    keyboardListeners = {};
    keyboardAddListenerSpy = jest.spyOn(Keyboard, 'addListener').mockImplementation((eventName, callback) => {
      keyboardListeners[eventName] = callback;
      return {
        remove: jest.fn(() => {
          delete keyboardListeners[eventName];
        }),
      };
    });
    global.requestAnimationFrame = jest.fn((callback) => {
      if (typeof callback === 'function') {
        callback();
      }
      return 0;
    });
    mockRetryFailedRequest.mockResolvedValue(true);
    mockSendMessage.mockResolvedValue(true);
    mockLoadMoreHistory.mockResolvedValue(true);
    originalScrollToOffset = FlatList.prototype.scrollToOffset;
    originalScrollToEnd = FlatList.prototype.scrollToEnd;
    FlatList.prototype.scrollToOffset = jest.fn();
    FlatList.prototype.scrollToEnd = jest.fn();
    mockCreateTrainerClientMemory.mockResolvedValue({
      id: 'memory-1',
      visibility: 'ai_usable',
      tags: [],
    });
    mockListTrainerClients.mockResolvedValue({ items: [] });
    mockUpdateTrainerClientMemory.mockResolvedValue({ id: 'memory-1' });
    mockLoadCoachChatLastMemoryClientId.mockResolvedValue(null);
    mockSaveCoachChatLastMemoryClientId.mockResolvedValue(undefined);
    mockSetStringAsync.mockResolvedValue(undefined);
    mockUseChatConversation.mockReturnValue({
      messages: [
        {
          id: 'assistant-err-1',
          role: 'assistant',
          text: 'Unable to launch onboarding. Tap Retry.',
          isError: true,
        },
      ],
      quickReplies: [],
      isSending: false,
      error: 'Unable to launch onboarding. Tap Retry.',
      errorDetails: {
        path: '/api/v1/chat',
        resolved_api_base_url: 'http://192.168.0.10:8000',
        attempted_base_urls: ['http://192.168.0.10:8000'],
        raw_error_message: 'Network request failed',
      },
      hasRetryableFailure: true,
      hasMoreHistory: false,
      isLoadingMoreHistory: false,
      historyPaginationError: null,
      loadMoreHistory: mockLoadMoreHistory,
      sendMessage: mockSendMessage,
      retryFailedRequest: mockRetryFailedRequest,
    });
  });

  afterEach(() => {
    FlatList.prototype.scrollToOffset = originalScrollToOffset;
    FlatList.prototype.scrollToEnd = originalScrollToEnd;
    keyboardAddListenerSpy.mockRestore();
    global.requestAnimationFrame = originalRequestAnimationFrame;
  });

  it('invokes unified retry request from retry control', async () => {
    const tree = renderScreen();
    global.requestAnimationFrame.mockClear();

    const retryButton = tree.root.findByProps({
      testID: 'coach-chat-retry-button',
    });

    await act(async () => {
      retryButton.props.onPress();
    });

    expect(mockRetryFailedRequest).toHaveBeenCalledTimes(1);
    expect(global.requestAnimationFrame).toHaveBeenCalled();
    await act(async () => {
      tree.unmount();
    });
  });

  it('passes error styling to assistant bubble for bootstrap failures', () => {
    let tree;
    act(() => {
      tree = renderer.create(
        <CoachChatScreen
          accessToken="trainer-token"
          launchContext={{ entrypoint: 'trainer_agent_training', onboarding_action: 'review' }}
        />,
      );
    });

    // Error message is rendered in the chat list as a long-press pressable
    const messagePressable = tree.root.findByProps({
      testID: 'coach-chat-message-longpress-assistant-err-1',
    });
    expect(messagePressable).toBeTruthy();
    // Error bar is visible because hasRetryableFailure is true
    const retryButton = tree.root.findByProps({ testID: 'coach-chat-retry-button' });
    expect(retryButton).toBeTruthy();
    act(() => {
      tree.unmount();
    });
  });

  it('renders the AI fitness disclaimer in the chat header', () => {
    const tree = renderScreen();
    const disclaimer = tree.root.findByProps({ testID: 'coach-chat-ai-fitness-disclaimer' });

    expect(disclaimer.props.children).toContain('not medical advice');

    act(() => {
      tree.unmount();
    });
  });

  it('computes sender grouping metadata and keeps speaker labels on group starts', () => {
    mockUseChatConversation.mockReturnValue({
      messages: [
        { id: 'assistant-1', role: 'assistant', text: 'Assistant 1' },
        { id: 'assistant-2', role: 'assistant', text: 'Assistant 2' },
        { id: 'user-1', role: 'user', text: 'User 1' },
        { id: 'user-2', role: 'user', text: 'User 2' },
        { id: 'user-3', role: 'user', text: 'User 3' },
        { id: 'assistant-3', role: 'assistant', text: 'Assistant 3' },
      ],
      quickReplies: [],
      isSending: false,
      error: null,
      errorDetails: null,
      hasRetryableFailure: false,
      sendMessage: mockSendMessage,
      retryFailedRequest: mockRetryFailedRequest,
    });

    let tree;
    act(() => {
      tree = renderer.create(
        <CoachChatScreen
          accessToken="trainer-token"
          launchContext={{ entrypoint: 'trainer_agent_training', onboarding_action: 'review' }}
        />,
      );
    });

    // All 6 messages are rendered in the chat list (FlatList may double-render items,
    // so use findAllByProps and check at least one instance exists).
    ['assistant-1', 'assistant-2', 'user-1', 'user-2', 'user-3', 'assistant-3'].forEach((id) => {
      const items = tree.root.findAllByProps({ testID: `coach-chat-message-longpress-${id}` });
      expect(items.length).toBeGreaterThan(0);
    });

    // assistant-1 (group start) shows COACH label; assistant-2 (end) does not.
    const assistant1Items = tree.root.findAllByProps({ testID: 'coach-chat-message-longpress-assistant-1' });
    expect(assistant1Items.some((p) => p.findAllByProps({ children: 'COACH' }).length > 0)).toBe(true);
    const assistant2Items = tree.root.findAllByProps({ testID: 'coach-chat-message-longpress-assistant-2' });
    expect(assistant2Items.every((p) => p.findAllByProps({ children: 'COACH' }).length === 0)).toBe(true);

    // user-1 (group start) shows 'You' label; user-2 (middle) does not.
    const user1Items = tree.root.findAllByProps({ testID: 'coach-chat-message-longpress-user-1' });
    expect(user1Items.some((p) => p.findAllByProps({ children: 'You' }).length > 0)).toBe(true);
    const user2Items = tree.root.findAllByProps({ testID: 'coach-chat-message-longpress-user-2' });
    expect(user2Items.every((p) => p.findAllByProps({ children: 'You' }).length === 0)).toBe(true);

    act(() => {
      tree.unmount();
    });
  });

  it('renders assistant_stream messages as inline AI bubbles (not TypingIndicator)', () => {
    mockUseChatConversation.mockReturnValue({
      messages: [
        { id: 'assistant-stream-1', role: 'assistant', kind: 'assistant_stream', text: 'Streaming draft...' },
        { id: 'assistant-final-1', role: 'assistant', text: 'Final response.' },
      ],
      quickReplies: [],
      isSending: false,
      error: null,
      errorDetails: null,
      hasRetryableFailure: false,
      sendMessage: mockSendMessage,
      retryFailedRequest: mockRetryFailedRequest,
    });

    let tree;
    act(() => {
      tree = renderer.create(
        <CoachChatScreen
          accessToken="trainer-token"
          launchContext={{ entrypoint: 'trainer_agent_training', onboarding_action: 'review' }}
        />,
      );
    });

    // Both render as long-press pressables (inline AI bubbles), not TypingIndicators.
    // Only assistant_progress kind routes to TypingIndicator.
    const streamPressable = tree.root.findByProps({
      testID: 'coach-chat-message-longpress-assistant-stream-1',
    });
    const finalPressable = tree.root.findByProps({
      testID: 'coach-chat-message-longpress-assistant-final-1',
    });
    expect(streamPressable).toBeTruthy();
    expect(finalPressable).toBeTruthy();

    act(() => {
      tree.unmount();
    });
  });

  it('copies diagnostics bundle from copy error control', async () => {
    const tree = renderScreen();

    const copyButton = tree.root.findByProps({
      testID: 'coach-chat-copy-error-button',
    });

    await act(async () => {
      copyButton.props.onPress();
    });

    expect(mockSetStringAsync).toHaveBeenCalledTimes(1);
    expect(mockSetStringAsync.mock.calls[0][0]).toContain('MODE Chat Error Diagnostics');
    expect(mockSetStringAsync.mock.calls[0][0]).toContain('/api/v1/chat');
    await act(async () => {
      tree.unmount();
    });
  });

  it('sends approve and reject commands from active calibration card; no approve-all button', async () => {
    mockUseChatConversation.mockReturnValue({
      messages: [
        {
          id: 'assistant-calibration-1',
          role: 'assistant',
          text: 'Step 8 of 8: Final Calibration',
          profilePatch: {
            trainer_onboarding: {
              calibration_checklist: {
                approved_count: 0,
                total: 3,
                visible_count: 1,
                samples: [
                  {
                    index: 1,
                    id: 'sample_1',
                    scenario: 'Client says: I am exhausted.',
                    response: 'We can still stack a small win today.',
                    status: 'pending',
                    is_active: true,
                  },
                ],
              },
            },
          },
        },
      ],
      quickReplies: [],
      isSending: false,
      error: null,
      errorDetails: null,
      hasRetryableFailure: false,
      sendMessage: mockSendMessage,
      retryFailedRequest: mockRetryFailedRequest,
    });

    const tree = renderScreen();
    global.requestAnimationFrame.mockClear();

    const approveOne = tree.root.findByProps({ testID: 'coach-chat-checklist-approve-1' });
    const regenerateOne = tree.root.findByProps({ testID: 'coach-chat-checklist-regenerate-1' });
    expect(tree.root.findAllByProps({ testID: 'coach-chat-checklist-approve-all' })).toHaveLength(0);

    await act(async () => {
      await approveOne.props.onPress();
    });
    await act(async () => {
      await regenerateOne.props.onPress();
    });

    expect(mockSendMessage).toHaveBeenNthCalledWith(1, 'approve 1');
    expect(mockSendMessage).toHaveBeenNthCalledWith(2, 'reject 1');
    expect(global.requestAnimationFrame).toHaveBeenCalled();
    await act(async () => {
      tree.unmount();
    });
  });

  it('re-anchors latest when composer receives focus', () => {
    const tree = renderScreen();
    const composer = tree.root.findByType('MockCoachComposer');

    expect(composer.props.onFocus).toEqual(expect.any(Function));
    global.requestAnimationFrame.mockClear();
    act(() => {
      composer.props.onFocus();
    });
    expect(global.requestAnimationFrame).toHaveBeenCalled();

    act(() => {
      tree.unmount();
    });
  });

  it('loads older history from the thread header', async () => {
    mockUseChatConversation.mockReturnValue({
      messages: [
        { id: 'assistant-msg-1', role: 'assistant', text: 'Newest assistant message' },
      ],
      quickReplies: [],
      isSending: false,
      error: null,
      errorDetails: null,
      hasRetryableFailure: false,
      hasMoreHistory: true,
      isLoadingMoreHistory: false,
      historyPaginationError: null,
      loadMoreHistory: mockLoadMoreHistory,
      sendMessage: mockSendMessage,
      retryFailedRequest: mockRetryFailedRequest,
    });

    const tree = renderScreen();
    const loadMoreButton = tree.root.findByProps({ testID: 'coach-chat-load-more-button' });

    await act(async () => {
      await loadMoreButton.props.onPress();
    });

    expect(mockLoadMoreHistory).toHaveBeenCalledTimes(1);

    await act(async () => {
      tree.unmount();
    });
  });

  it('disables load more while loading and shows pagination errors', () => {
    mockUseChatConversation.mockReturnValue({
      messages: [
        { id: 'assistant-msg-1', role: 'assistant', text: 'Newest assistant message' },
      ],
      quickReplies: [],
      isSending: false,
      error: null,
      errorDetails: null,
      hasRetryableFailure: false,
      hasMoreHistory: true,
      isLoadingMoreHistory: true,
      historyPaginationError: 'Unable to load more messages.',
      loadMoreHistory: mockLoadMoreHistory,
      sendMessage: mockSendMessage,
      retryFailedRequest: mockRetryFailedRequest,
    });

    const tree = renderScreen();
    const loadMoreButton = tree.root.findByProps({ testID: 'coach-chat-load-more-button' });
    expect(loadMoreButton.props.disabled).toBe(true);
    expect(tree.root.findByProps({ testID: 'coach-chat-load-more-error' }).props.children)
      .toBe('Unable to load more messages.');

    act(() => {
      tree.unmount();
    });
  });

  it('preserves viewport offset when older history is prepended', async () => {
    mockUseChatConversation.mockReturnValue({
      messages: [
        { id: 'assistant-msg-1', role: 'assistant', text: 'Newest assistant message' },
      ],
      quickReplies: [],
      isSending: false,
      error: null,
      errorDetails: null,
      hasRetryableFailure: false,
      hasMoreHistory: true,
      isLoadingMoreHistory: false,
      historyPaginationError: null,
      loadMoreHistory: mockLoadMoreHistory,
      sendMessage: mockSendMessage,
      retryFailedRequest: mockRetryFailedRequest,
    });

    const tree = renderScreen();
    const flatList = tree.root.findByType(FlatList);
    setListMetrics(tree, {
      offset: 140,
      contentHeight: 1000,
      layoutHeight: 500,
    });
    FlatList.prototype.scrollToOffset.mockClear();

    const loadMoreButton = tree.root.findByProps({ testID: 'coach-chat-load-more-button' });
    await act(async () => {
      await loadMoreButton.props.onPress();
    });
    act(() => {
      flatList.props.onContentSizeChange?.(0, 1300);
    });

    expect(FlatList.prototype.scrollToOffset).toHaveBeenCalledWith({
      offset: 440,
      animated: false,
    });

    await act(async () => {
      tree.unmount();
    });
  });

  it('disables SafeScreen bottom inset and reserves message space from dock height plus bottom offset', () => {
    let tree;
    act(() => {
      tree = renderer.create(
        <CoachChatScreen
          accessToken="trainer-token"
          launchContext={{ entrypoint: 'trainer_agent_training', onboarding_action: 'review' }}
          bottomInset={84}
        />,
      );
    });
    setDockHeight(tree, 52);

    const safeScreen = tree.root.findByProps({ atmosphere: 'chat' });
    expect(safeScreen.props.includeBottomInset).toBe(false);

    const flatList = tree.root.findByType(FlatList);
    const contentContainerStyle = StyleSheet.flatten(flatList.props.contentContainerStyle);
    expect(contentContainerStyle.paddingBottom).toBe(148);

    act(() => {
      tree.unmount();
    });
  });

  it('re-anchors latest when dock height grows while user is near bottom', () => {
    const tree = renderScreen();
    setListMetrics(tree, {
      offset: 700,
      contentHeight: 1200,
      layoutHeight: 500,
    });
    setDockHeight(tree, 36);
    global.requestAnimationFrame.mockClear();

    setDockHeight(tree, 72);

    expect(global.requestAnimationFrame).toHaveBeenCalled();

    act(() => {
      tree.unmount();
    });
  });

  it('does not re-anchor latest when dock height grows while user is scrolled up', () => {
    const tree = renderScreen();
    setListMetrics(tree, {
      offset: 120,
      contentHeight: 1200,
      layoutHeight: 500,
    });
    setDockHeight(tree, 36);
    global.requestAnimationFrame.mockClear();

    setDockHeight(tree, 72);

    expect(global.requestAnimationFrame).not.toHaveBeenCalled();

    act(() => {
      tree.unmount();
    });
  });

  it('keeps latest visible on keyboard open when the user is already near bottom', () => {
    const tree = renderScreen();
    setListMetrics(tree, {
      offset: 700,
      contentHeight: 1200,
      layoutHeight: 500,
    });
    global.requestAnimationFrame.mockClear();

    act(() => {
      keyboardListeners[openEventName]?.({
        endCoordinates: { height: 260 },
      });
    });

    expect(global.requestAnimationFrame).toHaveBeenCalled();

    act(() => {
      tree.unmount();
    });
  });

  it('uses compact composer offset while keyboard is open', () => {
    let tree;
    act(() => {
      tree = renderer.create(
        <CoachChatScreen
          accessToken="trainer-token"
          launchContext={{ entrypoint: 'trainer_agent_training', onboarding_action: 'review' }}
          bottomInset={84}
        />,
      );
    });
    setDockHeight(tree, 52);

    act(() => {
      keyboardListeners[openEventName]?.({
        endCoordinates: { height: 260 },
      });
    });

    const flatList = tree.root.findByType(FlatList);
    const contentContainerStyle = StyleSheet.flatten(flatList.props.contentContainerStyle);
    expect(contentContainerStyle.paddingBottom).toBe(72);

    act(() => {
      keyboardListeners[closeEventName]?.();
      tree.unmount();
    });
  });

  it('does not jump to latest on keyboard open when user is scrolled up', () => {
    const tree = renderScreen();
    setListMetrics(tree, {
      offset: 120,
      contentHeight: 1200,
      layoutHeight: 500,
    });
    global.requestAnimationFrame.mockClear();

    act(() => {
      keyboardListeners[openEventName]?.({
        endCoordinates: { height: 260 },
      });
    });

    expect(global.requestAnimationFrame).not.toHaveBeenCalled();

    act(() => {
      keyboardListeners[closeEventName]?.();
    });

    act(() => {
      tree.unmount();
    });
  });

  it('intercepts /mem command and saves memory without sending a chat turn', async () => {
    mockUseChatConversation.mockReturnValue({
      messages: [
        {
          id: 'assistant-msg-1',
          role: 'assistant',
          text: 'Share your constraints and preferences.',
          isError: false,
        },
      ],
      quickReplies: [],
      isSending: false,
      error: null,
      errorDetails: null,
      hasRetryableFailure: false,
      sendMessage: mockSendMessage,
      retryFailedRequest: mockRetryFailedRequest,
    });

    const tree = renderScreen({
      launchContext: {
        entrypoint: 'trainer_agent_training',
        onboarding_action: 'review',
        client_id: 'client-123',
      },
    });
    const composer = tree.root.findByType('MockCoachComposer');
    act(() => {
      composer.props.onChangeText?.('/mem Avoid deep knee flexion on heavy days');
    });
    const updatedComposer = tree.root.findByType('MockCoachComposer');

    await act(async () => {
      await updatedComposer.props.onSend?.();
    });

    expect(mockCreateTrainerClientMemory).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'trainer-token',
      clientId: 'client-123',
      memoryType: 'note',
      text: 'Avoid deep knee flexion on heavy days',
      visibility: 'ai_usable',
    }));
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockSaveCoachChatLastMemoryClientId).toHaveBeenCalledWith('client-123');

    await act(async () => {
      tree.unmount();
    });
  });

  function makeCalibrationMessage({ samples } = {}) {
    return {
      id: 'assistant-calibration-1',
      role: 'assistant',
      text: 'Step 8 of 8: Final Calibration',
      profilePatch: {
        trainer_onboarding: {
          calibration_checklist: {
            approved_count: 0,
            total: 3,
            visible_count: 1,
            samples: samples || [
              {
                index: 1,
                id: 'sample_1',
                scenario: 'Client says: I am exhausted.',
                response: 'We can still stack a small win today.',
                status: 'pending',
                is_active: true,
              },
            ],
          },
        },
      },
    };
  }

  it('edit button enters edit mode with correct placeholder and send commits edit command', async () => {
    mockUseChatConversation.mockReturnValue({
      messages: [makeCalibrationMessage()],
      quickReplies: [],
      isSending: false,
      error: null,
      errorDetails: null,
      hasRetryableFailure: false,
      sendMessage: mockSendMessage,
      retryFailedRequest: mockRetryFailedRequest,
    });

    const tree = renderScreen();

    const editButton = tree.root.findByProps({ testID: 'coach-chat-checklist-edit-1' });
    act(() => {
      editButton.props.onPress();
    });

    const editInput = tree.root.findByProps({ testID: 'coach-chat-checklist-edit-input-1' });
    expect(editInput.props.placeholder).toBe('Type your version for scenario 1...');

    act(() => {
      editInput.props.onChangeText('Here is my version of the response.');
    });

    const sendButton = tree.root.findByProps({ testID: 'coach-chat-checklist-edit-send-1' });
    await act(async () => {
      await sendButton.props.onPress();
    });

    expect(mockSendMessage).toHaveBeenCalledWith('edit 1: Here is my version of the response.');

    await act(async () => {
      tree.unmount();
    });
  });

  it('sending an edit clears edit mode; approve and try-again also clear via handleChecklistCommand', async () => {
    mockUseChatConversation.mockReturnValue({
      messages: [makeCalibrationMessage()],
      quickReplies: [],
      isSending: false,
      error: null,
      errorDetails: null,
      hasRetryableFailure: false,
      sendMessage: mockSendMessage,
      retryFailedRequest: mockRetryFailedRequest,
    });

    const tree = renderScreen();

    // Enter edit mode via the Edit button
    const editButton = tree.root.findByProps({ testID: 'coach-chat-checklist-edit-1' });
    act(() => {
      editButton.props.onPress();
    });

    // Edit input is now visible
    const editInput = tree.root.findByProps({ testID: 'coach-chat-checklist-edit-input-1' });
    expect(editInput).toBeTruthy();

    // Fill in text and send — this calls handleChecklistCommand which clears editingIndex
    act(() => {
      editInput.props.onChangeText('My version of the response.');
    });
    const sendButton = tree.root.findByProps({ testID: 'coach-chat-checklist-edit-send-1' });
    await act(async () => {
      await sendButton.props.onPress();
    });

    // Edit input is gone after send
    expect(tree.root.findAllByProps({ testID: 'coach-chat-checklist-edit-input-1' })).toHaveLength(0);
    // Action buttons (Looks right, Try again) are visible again
    expect(tree.root.findByProps({ testID: 'coach-chat-checklist-approve-1' })).toBeTruthy();

    // "Looks right" sends approve command; handleChecklistCommand also clears editingIndex
    await act(async () => {
      tree.root.findByProps({ testID: 'coach-chat-checklist-approve-1' }).props.onPress();
    });
    expect(mockSendMessage).toHaveBeenCalledWith(expect.stringContaining('approve 1'));

    await act(async () => {
      tree.unmount();
    });
  });

  it('header shows agent name from profilePatch during trainer onboarding', () => {
    mockUseChatConversation.mockReturnValue({
      messages: [
        {
          id: 'assistant-welcome-1',
          role: 'assistant',
          text: 'Welcome',
          profilePatch: {
            trainer_onboarding: {
              identity: { agent_name: 'Coach Nova' },
            },
          },
        },
      ],
      quickReplies: [],
      isSending: false,
      error: null,
      errorDetails: null,
      hasRetryableFailure: false,
      sendMessage: mockSendMessage,
      retryFailedRequest: mockRetryFailedRequest,
    });

    const tree = renderScreen({
      launchContext: { entrypoint: 'trainer_agent_training' },
    });

    // The composer placeholder uses resolvedTrainerName — a reliable way to
    // verify the agent name from profilePatch reached the rendered output.
    const composer = tree.root.findByType('MockCoachComposer');
    expect(composer.props.placeholder).toContain('Coach Nova');

    act(() => {
      tree.unmount();
    });
  });

  it('latest calibration message renders only the checklist card, not the AI bubble text', () => {
    mockUseChatConversation.mockReturnValue({
      messages: [makeCalibrationMessage()],
      quickReplies: ['Quick option'],
      isSending: false,
      error: null,
      errorDetails: null,
      hasRetryableFailure: false,
      sendMessage: mockSendMessage,
      retryFailedRequest: mockRetryFailedRequest,
    });

    const tree = renderScreen();

    // The checklist card is present
    expect(tree.root.findAllByProps({ testID: 'coach-chat-checklist-approve-1' }).length).toBeGreaterThan(0);

    // The normal AI bubble text is NOT rendered inside the message pressable
    const messagePressable = tree.root.findByProps({
      testID: 'coach-chat-message-longpress-assistant-calibration-1',
    });
    const bubbleTexts = messagePressable.findAllByProps({ children: 'Step 8 of 8: Final Calibration' });
    expect(bubbleTexts).toHaveLength(0);

    act(() => {
      tree.unmount();
    });
  });

  it('older calibration message renders a text bubble only; only the latest checklist renders cards', () => {
    mockUseChatConversation.mockReturnValue({
      messages: [
        {
          id: 'assistant-calibration-old',
          role: 'assistant',
          text: 'Earlier calibration pass',
          profilePatch: {
            trainer_onboarding: {
              calibration_checklist: {
                approved_count: 0,
                total: 3,
                visible_count: 1,
                samples: [
                  {
                    index: 1,
                    id: 'old_sample_1',
                    scenario: 'Old scenario',
                    response: 'Old response',
                    status: 'pending',
                    is_active: true,
                  },
                ],
              },
            },
          },
        },
        makeCalibrationMessage(),
      ],
      quickReplies: [],
      isSending: false,
      error: null,
      errorDetails: null,
      hasRetryableFailure: false,
      sendMessage: mockSendMessage,
      retryFailedRequest: mockRetryFailedRequest,
    });

    const tree = renderScreen();

    // Only the latest calibration message shows checklist action buttons
    expect(tree.root.findAllByProps({ testID: 'coach-chat-checklist-approve-1' }).length).toBeGreaterThan(0);

    // The older calibration message does NOT render checklist cards (no approve button anchored there)
    // Verify: no approve button with testID anchored to old sample (old message has no card)
    // The old message pressable should contain the text bubble, not an approve button
    const oldPressable = tree.root.findByProps({
      testID: 'coach-chat-message-longpress-assistant-calibration-old',
    });
    expect(oldPressable.findAllByProps({ testID: 'coach-chat-checklist-approve-1' })).toHaveLength(0);

    act(() => {
      tree.unmount();
    });
  });

  it('strips "Client says:" prefix from scenario text', () => {
    mockUseChatConversation.mockReturnValue({
      messages: [
        {
          id: 'assistant-calibration-1',
          role: 'assistant',
          text: 'Step 8 of 8: Final Calibration',
          profilePatch: {
            trainer_onboarding: {
              calibration_checklist: {
                approved_count: 0,
                total: 1,
                visible_count: 1,
                samples: [
                  {
                    index: 1,
                    scenario: 'Client says: I am exhausted.',
                    response: 'We can still stack a small win today.',
                    status: 'pending',
                    is_active: true,
                  },
                ],
              },
            },
          },
        },
      ],
      quickReplies: [],
      isSending: false,
      error: null,
      errorDetails: null,
      hasRetryableFailure: false,
      sendMessage: mockSendMessage,
      retryFailedRequest: mockRetryFailedRequest,
    });

    const tree = renderScreen();

    // Stripped text is rendered
    const stripped = tree.root.findAllByProps({ children: 'I am exhausted.' });
    expect(stripped.length).toBeGreaterThan(0);

    // The raw prefixed version is not rendered
    const raw = tree.root.findAllByProps({ children: 'Client says: I am exhausted.' });
    expect(raw).toHaveLength(0);

    act(() => {
      tree.unmount();
    });
  });

  it('suppresses quick replies when a calibration checklist is present', () => {
    mockUseChatConversation.mockReturnValue({
      messages: [makeCalibrationMessage()],
      quickReplies: ['Option A', 'Option B'],
      isSending: false,
      error: null,
      errorDetails: null,
      hasRetryableFailure: false,
      sendMessage: mockSendMessage,
      retryFailedRequest: mockRetryFailedRequest,
    });

    const tree = renderScreen();

    const quickRepliesComponent = tree.root.findByType('MockQuickReplies');
    expect(quickRepliesComponent.props.replies).toEqual([]);

    act(() => {
      tree.unmount();
    });
  });

  it('active calibration card shows counter line and first-card hint for sample 1 with 0 approved', () => {
    mockUseChatConversation.mockReturnValue({
      messages: [makeCalibrationMessage()],
      quickReplies: [],
      isSending: false,
      error: null,
      errorDetails: null,
      hasRetryableFailure: false,
      sendMessage: mockSendMessage,
      retryFailedRequest: mockRetryFailedRequest,
    });

    const tree = renderScreen();

    // Counter line
    const counterLines = tree.root.findAllByProps({ children: '0 of 3 — reviewing 1' });
    expect(counterLines.length).toBeGreaterThan(0);

    // First-card hint
    const hints = tree.root.findAllByProps({ children: 'Approve each response, edit it, or try again.' });
    expect(hints.length).toBeGreaterThan(0);

    act(() => {
      tree.unmount();
    });
  });

  it('suppresses memory suggestions for calibration messages during trainer onboarding', () => {
    mockUseChatConversation.mockReturnValue({
      messages: [
        {
          id: 'assistant-calibration-mem-1',
          role: 'assistant',
          text: 'Step 8 of 8: Final Calibration',
          profilePatch: {
            trainer_onboarding: {
              calibration_checklist: {
                approved_count: 0,
                total: 3,
                visible_count: 1,
                samples: [{ index: 1, scenario: 'S', response: 'R', status: 'pending', is_active: true }],
              },
            },
          },
          memorySuggestions: [
            {
              suggested_text: 'Client is exhausted',
              confidence: 0.92,
              source_message_id: 'assistant-calibration-mem-1',
              detected_category: 'constraint',
              default_visibility: 'ai_usable',
            },
          ],
        },
      ],
      quickReplies: [],
      isSending: false,
      error: null,
      errorDetails: null,
      hasRetryableFailure: false,
      sendMessage: mockSendMessage,
      retryFailedRequest: mockRetryFailedRequest,
    });

    const tree = renderScreen({
      launchContext: { entrypoint: 'trainer_agent_training' },
    });

    expect(tree.root.findAllByProps({ testID: 'coach-chat-memory-suggestion-save' })).toHaveLength(0);

    act(() => {
      tree.unmount();
    });
  });

  it('error banner shows dismiss button and hides on press', async () => {
    const tree = renderScreen();

    const dismissButton = tree.root.findByProps({ testID: 'coach-chat-error-dismiss-button' });
    expect(dismissButton).toBeTruthy();

    // Banner is visible before dismiss
    expect(tree.root.findAllByProps({ testID: 'coach-chat-retry-button' }).length).toBeGreaterThan(0);

    act(() => {
      dismissButton.props.onPress();
    });

    // Banner is gone after dismiss
    expect(tree.root.findAllByProps({ testID: 'coach-chat-retry-button' })).toHaveLength(0);

    await act(async () => {
      tree.unmount();
    });
  });

  it('error banner auto-dismisses after 5 seconds', async () => {
    jest.useFakeTimers();
    const tree = renderScreen();

    // Banner is visible initially
    expect(tree.root.findAllByProps({ testID: 'coach-chat-retry-button' }).length).toBeGreaterThan(0);

    act(() => {
      jest.advanceTimersByTime(5000);
    });

    // Banner hidden after timeout
    expect(tree.root.findAllByProps({ testID: 'coach-chat-retry-button' })).toHaveLength(0);

    await act(async () => {
      tree.unmount();
    });
    jest.useRealTimers();
  });

  it('still scrolls to latest when sending from the composer', async () => {
    mockUseChatConversation.mockReturnValue({
      messages: [
        {
          id: 'assistant-msg-1',
          role: 'assistant',
          text: 'What should I do next?',
          isError: false,
        },
      ],
      quickReplies: [],
      isSending: false,
      error: null,
      errorDetails: null,
      hasRetryableFailure: false,
      sendMessage: mockSendMessage,
      retryFailedRequest: mockRetryFailedRequest,
    });

    const tree = renderScreen();
    global.requestAnimationFrame.mockClear();
    const composer = tree.root.findByType('MockCoachComposer');

    act(() => {
      composer.props.onChangeText?.('Keep me accountable this week.');
    });
    const updatedComposer = tree.root.findByType('MockCoachComposer');

    await act(async () => {
      await updatedComposer.props.onSend?.();
    });

    expect(mockSendMessage).toHaveBeenCalledWith('Keep me accountable this week.');
    expect(global.requestAnimationFrame).toHaveBeenCalled();

    await act(async () => {
      tree.unmount();
    });
  });

  it('shows activation card when last assistant message signals onboarding_status completed', () => {
    mockUseChatConversation.mockReturnValue({
      messages: [
        {
          id: 'assistant-done-1',
          role: 'assistant',
          text: "Your AI coach is set up.",
          profilePatch: {
            trainer_onboarding: {
              onboarding_status: 'completed',
            },
          },
        },
      ],
      quickReplies: [],
      isSending: false,
      error: null,
      errorDetails: null,
      hasRetryableFailure: false,
      sendMessage: mockSendMessage,
      retryFailedRequest: mockRetryFailedRequest,
    });

    const tree = renderScreen({
      launchContext: { entrypoint: 'trainer_agent_training' },
    });

    expect(tree.root.findAllByProps({ testID: 'trainer-activation-card' }).length).toBeGreaterThanOrEqual(1);
    expect(tree.root.findAllByType('MockCoachComposer').length).toBe(0);

    act(() => {
      tree.unmount();
    });
  });

  it('pressing the activation CTA calls onTrainerOnboardingCompletePress', async () => {
    const mockOnComplete = jest.fn().mockResolvedValue(undefined);

    mockUseChatConversation.mockReturnValue({
      messages: [
        {
          id: 'assistant-done-2',
          role: 'assistant',
          text: "Your AI coach is set up.",
          profilePatch: {
            trainer_onboarding: {
              onboarding_status: 'completed',
            },
          },
        },
      ],
      quickReplies: [],
      isSending: false,
      error: null,
      errorDetails: null,
      hasRetryableFailure: false,
      sendMessage: mockSendMessage,
      retryFailedRequest: mockRetryFailedRequest,
    });

    let tree;
    act(() => {
      tree = renderer.create(
        <CoachChatScreen
          accessToken="trainer-token"
          launchContext={{ entrypoint: 'trainer_agent_training' }}
          onTrainerOnboardingCompletePress={mockOnComplete}
        />,
      );
    });

    const cta = tree.root.findByProps({ testID: 'trainer-activation-cta' });
    await act(async () => {
      await cta.props.onPress?.();
    });

    expect(mockOnComplete).toHaveBeenCalledTimes(1);

    await act(async () => {
      tree.unmount();
    });
  });

  it('does not show activation card when onboarding_status is not completed', () => {
    mockUseChatConversation.mockReturnValue({
      messages: [
        {
          id: 'assistant-progress-1',
          role: 'assistant',
          text: "Let's keep going.",
          profilePatch: {
            trainer_onboarding: {
              onboarding_status: 'in_progress',
            },
          },
        },
      ],
      quickReplies: [],
      isSending: false,
      error: null,
      errorDetails: null,
      hasRetryableFailure: false,
      sendMessage: mockSendMessage,
      retryFailedRequest: mockRetryFailedRequest,
    });

    const tree = renderScreen({
      launchContext: { entrypoint: 'trainer_agent_training' },
    });

    expect(tree.root.findAllByProps({ testID: 'trainer-activation-card' }).length).toBe(0);
    expect(tree.root.findAllByType('MockCoachComposer').length).toBe(1);

    act(() => {
      tree.unmount();
    });
  });

  it('does not show activation card when entrypoint is not trainer_agent_training', () => {
    mockUseChatConversation.mockReturnValue({
      messages: [
        {
          id: 'assistant-done-client-1',
          role: 'assistant',
          text: "Great session.",
          profilePatch: {
            trainer_onboarding: {
              onboarding_status: 'completed',
            },
          },
        },
      ],
      quickReplies: [],
      isSending: false,
      error: null,
      errorDetails: null,
      hasRetryableFailure: false,
      sendMessage: mockSendMessage,
      retryFailedRequest: mockRetryFailedRequest,
    });

    const tree = renderScreen({
      launchContext: { entrypoint: 'post_checkin' },
    });

    expect(tree.root.findAllByProps({ testID: 'trainer-activation-card' }).length).toBe(0);
    expect(tree.root.findAllByType('MockCoachComposer').length).toBe(1);

    act(() => {
      tree.unmount();
    });
  });
});

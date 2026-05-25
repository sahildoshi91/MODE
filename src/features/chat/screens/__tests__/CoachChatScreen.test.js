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
    expect(tree.root.findByProps({ testID: 'coach-chat-session-intro' })).toBeTruthy();
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

    const firstCall = mockChatBubble.mock.calls[0]?.[0];
    expect(firstCall.role).toBe('assistant');
    expect(firstCall.isError).toBe(true);
    act(() => {
      tree.unmount();
    });
  });

  it('renders the AI fitness disclaimer in the chat header', () => {
    const tree = renderScreen();
    const disclaimer = tree.root.findByProps({ testID: 'coach-chat-ai-fitness-disclaimer' });

    expect(disclaimer.props.children).toContain('AI-generated fitness coaching');
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

    const bubbleProps = mockChatBubble.mock.calls.map(([props]) => props);
    const propsForText = (text) => bubbleProps.find((item) => item?.text === text);

    expect(propsForText('Assistant 1')).toMatchObject({
      role: 'assistant',
      groupPosition: 'start',
      showSpeakerLabel: true,
    });
    expect(propsForText('Assistant 2')).toMatchObject({
      role: 'assistant',
      groupPosition: 'end',
      showSpeakerLabel: false,
    });
    expect(propsForText('User 1')).toMatchObject({
      role: 'user',
      groupPosition: 'start',
      showSpeakerLabel: true,
    });
    expect(propsForText('User 2')).toMatchObject({
      role: 'user',
      groupPosition: 'middle',
      showSpeakerLabel: false,
    });
    expect(propsForText('User 3')).toMatchObject({
      role: 'user',
      groupPosition: 'end',
      showSpeakerLabel: false,
    });
    expect(propsForText('Assistant 3')).toMatchObject({
      role: 'assistant',
      groupPosition: 'single',
      showSpeakerLabel: true,
    });

    act(() => {
      tree.unmount();
    });
  });

  it('passes message kind through to ChatBubble for stream/finalize rendering decisions', () => {
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

    const bubbleProps = mockChatBubble.mock.calls.map(([props]) => props);
    const streamBubble = bubbleProps.find((item) => item?.id === 'assistant-stream-1' || item?.text === 'Streaming draft...');
    const finalBubble = bubbleProps.find((item) => item?.id === 'assistant-final-1' || item?.text === 'Final response.');
    expect(streamBubble?.messageKind).toBe('assistant_stream');
    expect(finalBubble?.messageKind || null).toBe(null);

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

  it('sends checklist command messages from calibration controls', async () => {
    mockUseChatConversation.mockReturnValue({
      messages: [
        {
          id: 'assistant-calibration-1',
          role: 'assistant',
          text: 'Step 8 of 8: Final Calibration',
          profilePatch: {
            trainer_onboarding: {
              calibration_checklist: {
                approved_count: 1,
                total: 2,
                samples: [
                  {
                    index: 1,
                    id: 'sample_1',
                    scenario: 'Client says: I am exhausted.',
                    response: 'We can still stack a small win today.',
                    status: 'pending',
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
    const approveAll = tree.root.findByProps({ testID: 'coach-chat-checklist-approve-all' });

    await act(async () => {
      await approveOne.props.onPress();
      await regenerateOne.props.onPress();
      await approveAll.props.onPress();
    });

    expect(mockSendMessage).toHaveBeenNthCalledWith(1, 'approve 1');
    expect(mockSendMessage).toHaveBeenNthCalledWith(2, 'reject 1');
    expect(mockSendMessage).toHaveBeenNthCalledWith(3, 'approve all');
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
});

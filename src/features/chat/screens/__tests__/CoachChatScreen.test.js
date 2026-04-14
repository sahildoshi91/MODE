import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { FlatList, Keyboard, Platform } from 'react-native';

const mockUseChatConversation = jest.fn();
const mockRetryFailedRequest = jest.fn();
const mockSendMessage = jest.fn();
const mockSetStringAsync = jest.fn();
const mockChatBubble = jest.fn();

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

  function renderScreen() {
    let tree;
    act(() => {
      tree = renderer.create(
        <CoachChatScreen
          accessToken="trainer-token"
          launchContext={{ entrypoint: 'trainer_agent_training', onboarding_action: 'review' }}
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
      sendMessage: mockSendMessage,
      retryFailedRequest: mockRetryFailedRequest,
    });
  });

  afterEach(() => {
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

    const firstCall = mockChatBubble.mock.calls[0]?.[0];
    expect(firstCall.role).toBe('assistant');
    expect(firstCall.isError).toBe(true);
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

  it('does not force a bottom jump when composer receives focus', () => {
    const tree = renderScreen();
    const composer = tree.root.findByType('MockCoachComposer');

    expect(composer.props.onFocus).toBeUndefined();
    global.requestAnimationFrame.mockClear();
    if (composer.props.onFocus) {
      act(() => {
        composer.props.onFocus();
      });
    }
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

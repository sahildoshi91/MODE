jest.mock('../../services/trainerAssistantApi', () => ({
  approveTrainerAssistantDraft: jest.fn(),
  editTrainerAssistantDraft: jest.fn(),
  executeTrainerAssistantAction: jest.fn(),
  executeTrainerAssistantActionStream: jest.fn(),
  getTrainerAssistantBootstrap: jest.fn(),
  rejectTrainerAssistantDraft: jest.fn(),
}));

jest.mock('../../../trainerHome/services/trainerKnowledgeApi', () => ({
  createTrainerKnowledgeEntry: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaProvider: ({ children }) => children,
    SafeAreaView: ({ children }) => React.createElement('SafeAreaView', null, children),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

jest.mock('../../../trainerCoach/components/CoachPanelHost', () => {
  const React = require('react');
  const { Text, View } = require('react-native');

  return function MockCoachPanelHost({
    activePanel,
    panelContext,
  }) {
    return (
      <View testID="trainer-assistant-mock-panel-host">
        <Text testID="trainer-assistant-mock-panel-active">{`panel:${activePanel || 'none'}`}</Text>
        <Text testID="trainer-assistant-mock-panel-section">{`section:${panelContext?.initialSection || 'none'}`}</Text>
        <Text testID="trainer-assistant-mock-panel-filter">{`filter:${panelContext?.filter || 'none'}`}</Text>
      </View>
    );
  };
});

jest.mock('../../../trainerCoach/components/clientContextRail', () => {
  const React = require('react');
  const { Text, View } = require('react-native');

  return {
    ClientContextRail: ({ state, testIDPrefix = 'client-context-rail' }) => (
      <View testID={`${testIDPrefix}-root`}>
        <Text testID={`${testIDPrefix}-mode`}>{state?.railMode || 'collapsed'}</Text>
        {state?.railMode !== 'collapsed' ? (
          <View testID={`${testIDPrefix}-panel`} />
        ) : null}
      </View>
    ),
  };
});

jest.mock('../../../trainerCoach/hooks/useClientContextState', () => {
  const React = require('react');

  const CLIENT_CONTEXT_RAIL_MODE = {
    COLLAPSED: 'collapsed',
    EXPANDED: 'expanded',
    FULL: 'full',
  };

  function useClientContextState({ initialSelectedClientId = null } = {}) {
    const [state, setState] = React.useState({
      isRailVisible: false,
      railMode: CLIENT_CONTEXT_RAIL_MODE.COLLAPSED,
      selectedClientId: initialSelectedClientId,
      searchQuery: '',
      quickNoteText: '',
      allowAIUse: true,
      todayClients: [],
      recentClients: [],
      allClients: [],
      isSavingNote: false,
      saveStatus: 'idle',
      saveMessage: null,
      fullSection: 'advanced_ai_context',
      contextSummary: null,
      isSavingSchedule: false,
      scheduleSaveStatus: 'idle',
      scheduleDaysDraft: [],
      isSearching: false,
    });

    const actions = React.useMemo(() => ({
      expandRail: ({ focusSearch = false } = {}) => {
        setState((current) => ({
          ...current,
          isRailVisible: true,
          railMode: CLIENT_CONTEXT_RAIL_MODE.EXPANDED,
          searchQuery: focusSearch && !current.selectedClientId ? '' : current.searchQuery,
        }));
      },
      collapseRail: () => {
        setState((current) => ({
          ...current,
          isRailVisible: false,
          railMode: CLIENT_CONTEXT_RAIL_MODE.COLLAPSED,
        }));
      },
      dismissRail: () => {
        setState((current) => ({
          ...current,
          isRailVisible: false,
          railMode: CLIENT_CONTEXT_RAIL_MODE.COLLAPSED,
        }));
      },
      openFullRail: (section = 'advanced_ai_context') => {
        setState((current) => ({
          ...current,
          isRailVisible: true,
          railMode: CLIENT_CONTEXT_RAIL_MODE.FULL,
          fullSection: section,
        }));
      },
      backToExpandedRail: () => {
        setState((current) => ({
          ...current,
          isRailVisible: true,
          railMode: CLIENT_CONTEXT_RAIL_MODE.EXPANDED,
        }));
      },
      setSearchQuery: (value) => {
        setState((current) => ({ ...current, searchQuery: value }));
      },
      setQuickNoteText: (value) => {
        setState((current) => ({ ...current, quickNoteText: value }));
      },
      setAllowAIUse: (value) => {
        setState((current) => ({ ...current, allowAIUse: Boolean(value) }));
      },
      setSelectedClient: async (clientId) => {
        const normalized = String(clientId || '').trim() || null;
        setState((current) => (
          current.selectedClientId === normalized
            ? current
            : { ...current, selectedClientId: normalized }
        ));
      },
      hydrateSelectedClientId: (clientId) => {
        const normalized = String(clientId || '').trim() || null;
        setState((current) => (
          current.selectedClientId === normalized
            ? current
            : { ...current, selectedClientId: normalized }
        ));
      },
      saveQuickNote: async () => true,
      setScheduleDaysDraft: (days) => {
        setState((current) => ({ ...current, scheduleDaysDraft: days }));
      },
      saveScheduleDays: async () => true,
      refreshClients: async () => {},
    }), []);

    return {
      state,
      selectedClientSummary: state.selectedClientId
        ? { id: state.selectedClientId, name: 'Selected Client' }
        : null,
      actions,
    };
  }

  return {
    useClientContextState,
    CLIENT_CONTEXT_RAIL_MODE,
  };
});

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import TrainerAssistantScreen from '../TrainerAssistantScreen';
import {
  approveTrainerAssistantDraft,
  executeTrainerAssistantAction,
  executeTrainerAssistantActionStream,
  getTrainerAssistantBootstrap,
} from '../../services/trainerAssistantApi';
import { createTrainerKnowledgeEntry } from '../../../trainerHome/services/trainerKnowledgeApi';

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(),
}));

function buildBootstrapPayload(overrides = {}) {
  return {
    generated_at: '2026-04-18T08:00:00+00:00',
    active_client_id: 'client-1',
    requires_client_selection: false,
    clients: [
      {
        client_id: 'client-1',
        client_name: 'Taylor',
        priority_tier: 'high',
        scheduled_today: true,
        risk_labels: ['Missed Workouts'],
      },
    ],
    pulse_insights: [
      {
        id: 'client-1:low_workout_completion',
        client_id: 'client-1',
        label: 'Taylor: Missed Workouts',
        detail: 'Only one workout completed this week.',
        severity: 'high',
        action_type: 'adjust_plan',
        suggested_prompt: "Adjust Taylor's plan based on missed workouts.",
      },
    ],
    suggested_prompts: [
      "Adjust Taylor's plan based on missed workouts.",
      "Analyze Taylor's progress this week.",
      'Write a check-in message for Taylor.',
    ],
    context_bundle: {
      client_id: 'client-1',
      client_name: 'Taylor',
      adherence: { estimated_percent: 64 },
      plan_status: 'active',
    },
    ...overrides,
  };
}

function buildExecutePayload(actionType = 'adjust_plan') {
  return {
    draft_id: 'draft-1',
    output: {
      format_version: 'v1',
      action_type: actionType,
      headline: 'Draft Ready',
      summary: 'Structured draft generated.',
      sections: [
        { title: 'Draft', text: 'Preview content', items: [] },
      ],
      editable_payload: actionType === 'message_client'
        ? { message_draft: 'Hey Taylor, quick check-in from coach.' }
        : {
          what_changed: ['Reduced volume by 10%'],
          exercise_swaps: ['Back squat -> goblet squat'],
          sets_reps_intensity_changes: ['3x8 @ moderate effort'],
          reason: 'Recovery signals are mixed.',
        },
      preview_required: true,
      client_impacting: true,
      confidence: 0.83,
      next_actions: ['Edit', 'Approve'],
    },
    route: {
      reason: 'default_live',
      escalation_applied: false,
      fallback_applied: false,
      second_pass_applied: false,
    },
  };
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

let mountedTree = null;

async function renderScreen(overrides = {}) {
  let tree;
  await act(async () => {
    tree = renderer.create(
      <TrainerAssistantScreen
        accessToken="trainer-token"
        {...overrides}
      />,
    );
  });
  await flushEffects();
  mountedTree = tree;
  return tree;
}

describe('TrainerAssistantScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Clipboard.setStringAsync.mockResolvedValue(undefined);
    getTrainerAssistantBootstrap.mockResolvedValue(buildBootstrapPayload());
    executeTrainerAssistantActionStream.mockRejectedValue(new Error('stream unavailable'));
    executeTrainerAssistantAction.mockResolvedValue(buildExecutePayload('adjust_plan'));
    createTrainerKnowledgeEntry.mockResolvedValue({
      entry: { id: 'entry-1', scope: 'global', type: 'note', source: 'slash_command' },
    });
    approveTrainerAssistantDraft.mockResolvedValue({
      draft_id: 'draft-1',
      review_status: 'approved',
      output: buildExecutePayload('message_client').output,
    });
  });

  afterEach(async () => {
    if (mountedTree) {
      await act(async () => {
        mountedTree.unmount();
      });
      mountedTree = null;
    }
  });

  it('loads bootstrap with auto-selected client and suggestions', async () => {
    const tree = await renderScreen();
    const rendered = JSON.stringify(tree.toJSON());
    expect(rendered).toContain('Trainer Assistant');
    expect(rendered).toContain('Client: Taylor');
    expect(rendered).toContain("Adjust Taylor's plan based on missed workouts.");
    expect(getTrainerAssistantBootstrap).toHaveBeenCalledWith({
      accessToken: 'trainer-token',
      clientId: null,
    });
  });

  it('falls back to first available client when bootstrap has no active client', async () => {
    getTrainerAssistantBootstrap.mockResolvedValueOnce(buildBootstrapPayload({
      active_client_id: null,
      requires_client_selection: false,
      clients: [
        { client_id: 'client-1', client_name: 'Taylor' },
        { client_id: 'client-2', client_name: 'Jordan' },
      ],
      context_bundle: {},
    }));

    const tree = await renderScreen();
    const rendered = JSON.stringify(tree.toJSON());
    expect(rendered).toContain('Client: Taylor');
  });

  it('runs execute and renders preview card from action workflow', async () => {
    const tree = await renderScreen();

    const adjustChip = tree.root.findByProps({ testID: 'trainer-assistant-action-adjust_plan' });
    const generateButton = tree.root.findByProps({ testID: 'trainer-assistant-generate' });

    await act(async () => {
      adjustChip.props.onPress();
    });
    await act(async () => {
      await generateButton.props.onPress();
    });
    await flushEffects();

    expect(executeTrainerAssistantAction).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'trainer-token',
        clientId: 'client-1',
        actionType: 'adjust_plan',
      }),
    );
    expect(() => tree.root.findByProps({ testID: 'trainer-assistant-preview-card' })).not.toThrow();
  });

  it('opens the floating client context rail from /client command chip', async () => {
    const tree = await renderScreen();
    const clientCommandChip = tree.root.findByProps({ testID: 'trainer-assistant-command-client' });

    await act(async () => {
      clientCommandChip.props.onPress();
    });
    await flushEffects();

    expect(() => tree.root.findByProps({
      testID: 'trainer-assistant-client-context-rail-panel',
    })).not.toThrow();
    const rendered = JSON.stringify(tree.toJSON());
    expect(rendered).toContain('panel:none');
  });

  it('opens knowledge note panel from /note command chip', async () => {
    const tree = await renderScreen();
    const noteCommandChip = tree.root.findByProps({ testID: 'trainer-assistant-command-note' });

    await act(async () => {
      noteCommandChip.props.onPress();
    });
    await flushEffects();

    const rendered = JSON.stringify(tree.toJSON());
    expect(rendered).toContain('panel:note');
  });

  it('routes legacy /flag command to client-context settings rail, shows hint, and skips execute', async () => {
    const tree = await renderScreen();
    const promptInput = tree.root.findByProps({ testID: 'trainer-assistant-prompt-input' });
    const generateButton = tree.root.findByProps({ testID: 'trainer-assistant-generate' });

    await act(async () => {
      promptInput.props.onChangeText('/flag');
    });
    await act(async () => {
      await generateButton.props.onPress();
    });
    await flushEffects();

    const rendered = JSON.stringify(tree.toJSON());
    expect(() => tree.root.findByProps({
      testID: 'trainer-assistant-client-context-rail-panel',
    })).not.toThrow();
    expect(rendered).toContain('panel:none');
    expect(rendered).toContain('Heads up: `/flag` is now part of `/client` settings.');
    expect(executeTrainerAssistantActionStream).not.toHaveBeenCalled();
    expect(executeTrainerAssistantAction).not.toHaveBeenCalled();
  });

  it('shows local validation for unknown slash command and skips execute', async () => {
    const tree = await renderScreen();
    const promptInput = tree.root.findByProps({ testID: 'trainer-assistant-prompt-input' });
    const generateButton = tree.root.findByProps({ testID: 'trainer-assistant-generate' });

    await act(async () => {
      promptInput.props.onChangeText('/unknown');
    });
    await act(async () => {
      await generateButton.props.onPress();
    });
    await flushEffects();

    const rendered = JSON.stringify(tree.toJSON());
    expect(rendered).toContain('Unknown command: /unknown.');
    expect(executeTrainerAssistantActionStream).not.toHaveBeenCalled();
    expect(executeTrainerAssistantAction).not.toHaveBeenCalled();
  });

  it('saves /note payloads to coaching knowledge and skips assistant execute', async () => {
    const tree = await renderScreen();
    const promptInput = tree.root.findByProps({ testID: 'trainer-assistant-prompt-input' });
    const generateButton = tree.root.findByProps({ testID: 'trainer-assistant-generate' });

    await act(async () => {
      promptInput.props.onChangeText('/note Prioritize protein adherence before adding calories.');
    });
    await act(async () => {
      await generateButton.props.onPress();
    });
    await flushEffects();

    expect(createTrainerKnowledgeEntry).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'trainer-token',
      body: 'Prioritize protein adherence before adding calories.',
      type: 'note',
      scope: 'global',
      source: 'slash_command',
    }));
    expect(executeTrainerAssistantActionStream).not.toHaveBeenCalled();
    expect(executeTrainerAssistantAction).not.toHaveBeenCalled();

    const rendered = JSON.stringify(tree.toJSON());
    expect(rendered).toContain('Saved to Coaching Knowledge');
  });

  it('prompts for client selection when /clientnote is used with no active client', async () => {
    getTrainerAssistantBootstrap.mockResolvedValueOnce(buildBootstrapPayload({
      active_client_id: null,
      requires_client_selection: true,
      clients: [],
      context_bundle: {},
    }));
    const tree = await renderScreen();
    const promptInput = tree.root.findByProps({ testID: 'trainer-assistant-prompt-input' });
    const generateButton = tree.root.findByProps({ testID: 'trainer-assistant-generate' });

    await act(async () => {
      promptInput.props.onChangeText('/clientnote Keep this client on low-impact work after poor sleep.');
    });
    await act(async () => {
      await generateButton.props.onPress();
    });
    await flushEffects();

    expect(createTrainerKnowledgeEntry).not.toHaveBeenCalled();
    const rendered = JSON.stringify(tree.toJSON());
    expect(rendered).toContain('panel:note');
    expect(rendered).toContain('Select a client to save this note.');
  });

  it('treats escaped capture commands as literal prompt text for assistant execute', async () => {
    const tree = await renderScreen();
    const promptInput = tree.root.findByProps({ testID: 'trainer-assistant-prompt-input' });
    const generateButton = tree.root.findByProps({ testID: 'trainer-assistant-generate' });

    await act(async () => {
      promptInput.props.onChangeText('\\/note keep this as literal prompt');
    });
    await act(async () => {
      await generateButton.props.onPress();
    });
    await flushEffects();

    expect(createTrainerKnowledgeEntry).not.toHaveBeenCalled();
    expect(executeTrainerAssistantAction).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'trainer-token',
      clientId: 'client-1',
      message: '/note keep this as literal prompt',
    }));
  });

  it('approves preview draft through approve endpoint', async () => {
    executeTrainerAssistantAction.mockResolvedValueOnce(buildExecutePayload('message_client'));
    const tree = await renderScreen();
    const generateButton = tree.root.findByProps({ testID: 'trainer-assistant-generate' });

    await act(async () => {
      await generateButton.props.onPress();
    });
    await flushEffects();

    const approveButton = tree.root.findByProps({ testID: 'trainer-assistant-approve' });
    await act(async () => {
      await approveButton.props.onPress();
    });
    await flushEffects();

    expect(approveTrainerAssistantDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'trainer-token',
        draftId: 'draft-1',
      }),
    );
  });

  it('renders stale-backend recovery guidance for bootstrap not-found route errors', async () => {
    getTrainerAssistantBootstrap.mockRejectedValueOnce({
      message: 'Not found',
      status: 404,
      request_path: '/api/v1/trainer-assistant/bootstrap',
      api_base_url: 'http://127.0.0.1:8000',
      attempted_base_urls: ['http://127.0.0.1:8000', 'http://192.168.6.137:8000'],
      failover_attempted: true,
      failover_applied: true,
      is_missing_trainer_route: true,
    });
    getTrainerAssistantBootstrap.mockResolvedValueOnce(buildBootstrapPayload());

    const tree = await renderScreen();
    const rendered = JSON.stringify(tree.toJSON());
    expect(rendered).toContain('The backend appears stale and is missing trainer assistant routes.');
    expect(rendered).toContain('Missing route:');
    expect(rendered).toContain('/api/v1/trainer-assistant/bootstrap');

    const retryButton = tree.root.findByProps({ testID: 'trainer-assistant-bootstrap-retry' });
    const copyButton = tree.root.findByProps({ testID: 'trainer-assistant-bootstrap-copy' });
    await act(async () => {
      await copyButton.props.onPress();
    });
    await act(async () => {
      retryButton.props.onPress();
    });
    await flushEffects();

    expect(Clipboard.setStringAsync).toHaveBeenCalledTimes(1);
    expect(Clipboard.setStringAsync.mock.calls[0][0]).toContain('MODE Trainer Route Diagnostics');
    expect(Clipboard.setStringAsync.mock.calls[0][0]).toContain('/api/v1/trainer-assistant/bootstrap');
    expect(getTrainerAssistantBootstrap).toHaveBeenCalledTimes(2);
  });

  it('renders execution connectivity diagnostics and supports copy', async () => {
    executeTrainerAssistantAction.mockRejectedValueOnce({
      message: 'Unable to reach the backend for /api/v1/trainer-assistant/execute.',
      stage: 'network',
      path: '/api/v1/trainer-assistant/execute',
      request_path: '/api/v1/trainer-assistant/execute',
      resolved_api_base_url: 'http://192.168.6.137:8000',
      attempted_base_urls: ['http://192.168.6.137:8000', 'http://192.168.6.144:8000'],
      failover_attempted: true,
      failover_applied: false,
      recommended_api_base_url: 'http://192.168.6.144:8000',
      connectivity_probe: {
        endpoint_path: '/healthz',
        first_reachable_base_url: 'http://192.168.6.144:8000',
        candidate_api_base_urls: ['http://192.168.6.137:8000', 'http://192.168.6.144:8000'],
        attempts: [],
      },
    });

    const tree = await renderScreen();
    const generateButton = tree.root.findByProps({ testID: 'trainer-assistant-generate' });

    await act(async () => {
      await generateButton.props.onPress();
    });
    await flushEffects();

    expect(() => tree.root.findByProps({ testID: 'trainer-assistant-execution-connectivity' })).not.toThrow();
    const copyButton = tree.root.findByProps({ testID: 'trainer-assistant-execution-copy' });

    await act(async () => {
      await copyButton.props.onPress();
    });

    expect(Clipboard.setStringAsync).toHaveBeenCalledTimes(1);
    expect(Clipboard.setStringAsync.mock.calls[0][0]).toContain('Connectivity Probe');
    expect(Clipboard.setStringAsync.mock.calls[0][0]).toContain('Recommended API Base: http://192.168.6.144:8000');
  });

  it('configures keyboard handling props for assistant coach surfaces', async () => {
    const tree = await renderScreen();
    const keyboardAvoidingView = tree.root.findByType(KeyboardAvoidingView);
    const scrollView = tree.root.findByType(ScrollView);

    expect(keyboardAvoidingView.props.behavior).toBe(Platform.OS === 'ios' ? 'padding' : undefined);
    expect(scrollView.props.keyboardShouldPersistTaps).toBe('handled');
    expect(scrollView.props.keyboardDismissMode).toBe(Platform.OS === 'ios' ? 'interactive' : 'on-drag');
  });
});

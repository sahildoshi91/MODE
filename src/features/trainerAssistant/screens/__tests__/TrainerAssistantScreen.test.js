jest.mock('../../services/trainerAssistantApi', () => ({
  approveTrainerAssistantDraft: jest.fn(),
  editTrainerAssistantDraft: jest.fn(),
  executeTrainerAssistantAction: jest.fn(),
  getTrainerAssistantBootstrap: jest.fn(),
  rejectTrainerAssistantDraft: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaProvider: ({ children }) => children,
    SafeAreaView: ({ children }) => React.createElement('SafeAreaView', null, children),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

import React from 'react';
import renderer, { act } from 'react-test-renderer';

import TrainerAssistantScreen from '../TrainerAssistantScreen';
import {
  approveTrainerAssistantDraft,
  executeTrainerAssistantAction,
  getTrainerAssistantBootstrap,
} from '../../services/trainerAssistantApi';

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
  return tree;
}

describe('TrainerAssistantScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getTrainerAssistantBootstrap.mockResolvedValue(buildBootstrapPayload());
    executeTrainerAssistantAction.mockResolvedValue(buildExecutePayload('adjust_plan'));
    approveTrainerAssistantDraft.mockResolvedValue({
      draft_id: 'draft-1',
      review_status: 'approved',
      output: buildExecutePayload('message_client').output,
    });
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
});

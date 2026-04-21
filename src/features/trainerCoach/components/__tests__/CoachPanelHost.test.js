import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Pressable, Text, TextInput, View } from 'react-native';

jest.mock('../../../../../lib/components', () => {
  const React = require('react');
  const { Pressable, Text, TextInput, View } = require('react-native');

  return {
    GlassToggle: ({ value, onValueChange, testID }) => (
      <Pressable testID={testID} onPress={() => onValueChange?.(!value)}>
        <Text>{value ? 'on' : 'off'}</Text>
      </Pressable>
    ),
    ModeButton: ({ title, onPress, testID, style }) => (
      <Pressable testID={testID} onPress={onPress} style={style}>
        <Text>{title}</Text>
      </Pressable>
    ),
    ModeCard: ({ children, style }) => <View style={style}>{children}</View>,
    ModeChip: ({ label, onPress, testID }) => (
      <Pressable testID={testID} onPress={onPress}>
        <Text>{label}</Text>
      </Pressable>
    ),
    ModeInput: ({ testID, value, onChangeText, placeholder, multiline, style, keyboardType }) => (
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        multiline={multiline}
        style={style}
        keyboardType={keyboardType}
      />
    ),
    ModeText: ({ children, testID, style }) => <Text testID={testID} style={style}>{children}</Text>,
    SystemSearchBar: ({ testID, value, onChangeText, placeholder }) => (
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
      />
    ),
  };
});

jest.mock('../../../draftReview/components/DraftReviewStructuredCard', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return function MockDraftReviewStructuredCard() {
    return <Text>Draft Review Card</Text>;
  };
});

jest.mock('../../../trainerHome/services/trainerKnowledgeApi', () => ({
  archiveTrainerRule: jest.fn(),
  listTrainerRules: jest.fn(),
  updateTrainerRule: jest.fn(),
}));

jest.mock('../../services/trainerProgramsApi', () => ({
  archiveTrainerProgramTemplate: jest.fn(),
  createTrainerProgramTemplate: jest.fn(),
  listTrainerProgramTemplates: jest.fn(),
  patchTrainerProgramTemplate: jest.fn(),
}));

jest.mock('../../../trainerClients/services/trainerHomeApi', () => ({
  createTrainerClientMemory: jest.fn(),
  createTrainerClientScheduleException: jest.fn(),
  deleteTrainerClientScheduleException: jest.fn(),
  getTrainerClientAIContext: jest.fn(),
  getTrainerClientDetail: jest.fn(),
  listTrainerClients: jest.fn(),
  listTrainerClientMemory: jest.fn(),
  patchTrainerClientSchedulePreferences: jest.fn(),
  updateTrainerClientMeetingLocation: jest.fn(),
  updateTrainerClientMemory: jest.fn(),
}));

import CoachPanelHost from '../CoachPanelHost';
import { listTrainerProgramTemplates } from '../../services/trainerProgramsApi';
import {
  getTrainerClientAIContext,
  getTrainerClientDetail,
  listTrainerClientMemory,
  listTrainerClients,
} from '../../../trainerClients/services/trainerHomeApi';

function buildQueue() {
  return [
    {
      output_id: 'output-1',
      client_id: 'client-1',
      client_name: 'Sarah Jones',
      output_text: 'Draft one',
      output_json: {},
      action_type: 'adjust_plan',
      source_type: 'chat',
      priority_tier: 'high',
      headline: 'Draft one',
      summary: 'Summary one',
    },
    {
      output_id: 'output-2',
      client_id: 'client-2',
      client_name: 'Ava Smith',
      output_text: 'Draft two',
      output_json: {},
      action_type: 'adjust_plan',
      source_type: 'chat',
      priority_tier: 'normal',
      headline: 'Draft two',
      summary: 'Summary two',
    },
  ];
}

function hasText(tree, value) {
  return tree.root.findAll((node) => node.type === Text && node.props?.children === value).length > 0;
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('CoachPanelHost', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    listTrainerProgramTemplates.mockResolvedValue({ items: [] });
    listTrainerClientMemory.mockResolvedValue([]);
    listTrainerClients.mockResolvedValue({ items: buildQueue().map((item) => ({
      client_id: item.client_id,
      client_name: item.client_name,
    })) });
    getTrainerClientDetail.mockImplementation(async ({ clientId }) => ({
      client: {
        client_id: clientId,
        client_name: clientId === 'client-2' ? 'Ava Smith' : 'Sarah Jones',
      },
      schedule_preferences: {
        recurring_weekdays: [1, 3],
        preferred_meeting_location: 'Studio A',
        auto_use_trainer_default_location: true,
      },
      activity_summary: {
        avg_score_7d: 87,
        latest_checkin_date: '2026-04-19',
        session_status: 'scheduled',
        meeting_location: 'Studio A',
      },
    }));
    getTrainerClientAIContext.mockResolvedValue({
      applied_ai_usable_memory: [],
      internal_only_memory_count: 0,
      context_preview_text: 'Context preview',
    });
  });

  it('renders command-aware compact shell header and sticky footer action', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <CoachPanelHost
          accessToken="token"
          activePanel="program"
          panelContext={null}
          queue={buildQueue()}
          onClose={jest.fn()}
          onOpenTrainerCoach={jest.fn()}
          onApproveDraft={jest.fn()}
          onEditDraft={jest.fn()}
          onRejectDraft={jest.fn()}
          onSystemEvent={jest.fn()}
        />,
      );
    });

    await flushEffects();

    expect(hasText(tree, '/program')).toBe(true);
    expect(hasText(tree, 'Program Templates')).toBe(true);
    expect(hasText(tree, 'Close Panel')).toBe(true);

    await act(async () => {
      tree.unmount();
    });
  });

  it('keeps advanced JSON editor collapsed by default in /program and expands on toggle', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <CoachPanelHost
          accessToken="token"
          activePanel="program"
          panelContext={null}
          queue={buildQueue()}
          onClose={jest.fn()}
          onOpenTrainerCoach={jest.fn()}
          onApproveDraft={jest.fn()}
          onEditDraft={jest.fn()}
          onRejectDraft={jest.fn()}
          onSystemEvent={jest.fn()}
        />,
      );
    });

    await flushEffects();

    let jsonInputs = tree.root.findAll(
      (node) => node.type === TextInput && node.props?.placeholder === 'Template JSON',
    );
    expect(jsonInputs).toHaveLength(0);

    const toggle = tree.root.find(
      (node) => node.props?.testID === 'trainer-coach-program-create-advanced-toggle'
        && typeof node.props?.onPress === 'function',
    );
    await act(async () => {
      toggle.props.onPress();
    });

    jsonInputs = tree.root.findAll(
      (node) => node.type === TextInput && node.props?.placeholder === 'Template JSON',
    );
    expect(jsonInputs.length).toBeGreaterThan(0);

    await act(async () => {
      tree.unmount();
    });
  });

  it('uses name-based client picker and maps selection to client_id API calls', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <CoachPanelHost
          accessToken="token"
          activePanel="client_context"
          panelContext={null}
          queue={buildQueue()}
          onClose={jest.fn()}
          onOpenTrainerCoach={jest.fn()}
          onApproveDraft={jest.fn()}
          onEditDraft={jest.fn()}
          onRejectDraft={jest.fn()}
          onSystemEvent={jest.fn()}
        />,
      );
    });

    await flushEffects();

    expect(getTrainerClientDetail).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'token',
      clientId: 'client-1',
    }));

    const toggle = tree.root.find(
      (node) => node.props?.testID === 'trainer-coach-client-context-picker-toggle'
        && typeof node.props?.onPress === 'function',
    );
    await act(async () => {
      toggle.props.onPress();
    });

    const option = tree.root.find(
      (node) => node.props?.testID === 'trainer-coach-client-context-picker-option-client-2'
        && typeof node.props?.onPress === 'function',
    );
    await act(async () => {
      option.props.onPress();
    });
    await flushEffects();

    expect(getTrainerClientDetail).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'token',
      clientId: 'client-2',
    }));
  });

  it('keeps /memory advanced controls collapsed by default and expandable', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <CoachPanelHost
          accessToken="token"
          activePanel="memory"
          panelContext={{ clientId: 'client-1' }}
          queue={buildQueue()}
          onClose={jest.fn()}
          onOpenTrainerCoach={jest.fn()}
          onApproveDraft={jest.fn()}
          onEditDraft={jest.fn()}
          onRejectDraft={jest.fn()}
          onSystemEvent={jest.fn()}
        />,
      );
    });

    await flushEffects();

    expect(hasText(tree, 'No memory records yet.')).toBe(false);

    const toggle = tree.root.find(
      (node) => node.props?.testID === 'trainer-coach-memory-advanced-toggle'
        && typeof node.props?.onPress === 'function',
    );
    await act(async () => {
      toggle.props.onPress();
    });

    expect(hasText(tree, 'No memory records yet.')).toBe(true);

    await act(async () => {
      tree.unmount();
    });
  });
});

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import {
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

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
  archiveTrainerKnowledgeEntry: jest.fn(),
  archiveTrainerRule: jest.fn(),
  classifyTrainerKnowledgeEntry: jest.fn(),
  createTrainerKnowledgeEntry: jest.fn(),
  listTrainerKnowledgeEntries: jest.fn(),
  listTrainerRules: jest.fn(),
  updateTrainerKnowledgeEntry: jest.fn(),
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
import {
  archiveTrainerKnowledgeEntry,
  classifyTrainerKnowledgeEntry,
  createTrainerKnowledgeEntry,
  listTrainerKnowledgeEntries,
} from '../../../trainerHome/services/trainerKnowledgeApi';

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
  const openEventName = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
  const closeEventName = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
  let keyboardListeners = {};
  let keyboardRemoveMocks = [];
  let keyboardAddListenerSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    keyboardListeners = {};
    keyboardRemoveMocks = [];
    keyboardAddListenerSpy = jest.spyOn(Keyboard, 'addListener').mockImplementation((eventName, callback) => {
      keyboardListeners[eventName] = callback;
      const remove = jest.fn(() => {
        delete keyboardListeners[eventName];
      });
      keyboardRemoveMocks.push(remove);
      return { remove };
    });

    listTrainerProgramTemplates.mockResolvedValue({ items: [] });
    listTrainerKnowledgeEntries.mockResolvedValue([]);
    classifyTrainerKnowledgeEntry.mockResolvedValue({
      title: 'Recovered title',
      knowledge_type: 'coaching_rule',
      scope: 'global',
      tags: ['recovery'],
      ai_enabled: true,
      confidence: 0.81,
    });
    createTrainerKnowledgeEntry.mockResolvedValue({
      entry: {
        id: 'entry-1',
        title: 'Recovered title',
        raw_content: 'When sleep is poor, reduce intensity.',
        scope: 'global',
        knowledge_type: 'coaching_rule',
        tags: ['sleep'],
        ai_enabled: true,
        status: 'active',
        updated_at: '2026-04-21T16:00:00+00:00',
      },
      conflicts: [],
      safety: {
        ai_enabled_forced_off: false,
      },
    });
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

  afterEach(() => {
    keyboardAddListenerSpy?.mockRestore();
  });

  it('does not render deprecated client-context and memory modal panels', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <CoachPanelHost
          accessToken="token"
          activePanel="client_context"
          panelContext={{ initialSection: 'quick_note' }}
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
    expect(() => tree.root.findByProps({ testID: 'trainer-coach-panel-sheet' })).toThrow();

    await act(async () => {
      tree.update(
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
    expect(() => tree.root.findByProps({ testID: 'trainer-coach-panel-sheet' })).toThrow();

    await act(async () => {
      tree.unmount();
    });
  });

  it('renders the redesigned /note capture sheet without deprecated advanced toggle or close panel footer', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <CoachPanelHost
          accessToken="token"
          activePanel="note"
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

    expect(hasText(tree, 'Add to Coaching Knowledge')).toBe(false);
    expect(hasText(tree, 'Coaching Knowledge')).toBe(true);
    expect(hasText(tree, 'Close Panel')).toBe(false);
    expect(() => tree.root.findByProps({ testID: 'trainer-coach-note-dismiss' })).toThrow();
    expect(() => tree.root.findByProps({ testID: 'trainer-coach-note-swipe-dismiss' })).not.toThrow();
    expect(() => tree.root.findByProps({ testID: 'trainer-coach-knowledge-close' })).not.toThrow();
    expect(() => tree.root.findByProps({ testID: 'trainer-coach-knowledge-open-new' })).not.toThrow();
    expect(() => tree.root.findByProps({ testID: 'trainer-coach-knowledge-raw-input' })).toThrow();
    expect(() => tree.root.findByProps({ testID: 'trainer-coach-knowledge-editor-close' })).toThrow();
    expect(() => tree.root.findByProps({ testID: 'trainer-coach-knowledge-filter-menu' })).not.toThrow();

    await act(async () => {
      tree.unmount();
    });
  });

  it('re-opens create mode from New after canceling the compose-first editor', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <CoachPanelHost
          accessToken="token"
          activePanel="note"
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
    expect(() => tree.root.findByProps({ testID: 'trainer-coach-knowledge-raw-input' })).toThrow();

    await act(async () => {
      tree.root.findByProps({ testID: 'trainer-coach-knowledge-open-new' }).props.onPress();
    });

    expect(() => tree.root.findByProps({ testID: 'trainer-coach-knowledge-raw-input' })).not.toThrow();

    await act(async () => {
      tree.root.findByProps({ testID: 'trainer-coach-knowledge-editor-close' }).props.onPress();
    });

    expect(() => tree.root.findByProps({ testID: 'trainer-coach-knowledge-raw-input' })).toThrow();
    expect(() => tree.root.findByProps({ testID: 'trainer-coach-knowledge-open-new' })).not.toThrow();

    await act(async () => {
      tree.root.findByProps({ testID: 'trainer-coach-knowledge-open-new' }).props.onPress();
    });

    expect(() => tree.root.findByProps({ testID: 'trainer-coach-knowledge-raw-input' })).not.toThrow();

    await act(async () => {
      tree.unmount();
    });
  });

  it('renders compact knowledge rows with readable preview and icon actions', async () => {
    listTrainerKnowledgeEntries.mockResolvedValueOnce([
      {
        id: 'entry-1',
        title: 'Sleep adjustment',
        raw_content: 'When sleep is poor, reduce intensity and prioritize movement quality.',
        knowledge_type: 'coaching_rule',
        scope: 'global',
        tags: ['sleep'],
        ai_enabled: true,
        status: 'active',
        updated_at: '2026-04-22T16:00:00+00:00',
      },
    ]);

    let tree;
    await act(async () => {
      tree = renderer.create(
        <CoachPanelHost
          accessToken="token"
          activePanel="note"
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

    expect(hasText(tree, 'When sleep is poor, reduce intensity and prioritize movement quality.')).toBe(true);
    expect(hasText(tree, 'Edit')).toBe(false);
    expect(() => tree.root.findByProps({ testID: 'trainer-coach-knowledge-edit-entry-1' })).not.toThrow();
    expect(() => tree.root.findByProps({ testID: 'trainer-coach-knowledge-archive-entry-1' })).not.toThrow();
    expect(() => tree.root.findByProps({ testID: 'trainer-coach-knowledge-filter-archived' })).toThrow();

    await act(async () => {
      tree.unmount();
    });
  });

  it('opens archive confirmation dialog from row action', async () => {
    listTrainerKnowledgeEntries.mockResolvedValueOnce([
      {
        id: 'entry-1',
        title: 'Sleep adjustment',
        raw_content: 'When sleep is poor, reduce intensity.',
        knowledge_type: 'coaching_rule',
        scope: 'global',
        tags: ['sleep'],
        ai_enabled: true,
        status: 'active',
        updated_at: '2026-04-22T16:00:00+00:00',
      },
    ]);
    archiveTrainerKnowledgeEntry.mockResolvedValue({
      entry: {
        id: 'entry-1',
        title: 'Sleep adjustment',
        raw_content: 'When sleep is poor, reduce intensity.',
        knowledge_type: 'coaching_rule',
        scope: 'global',
        tags: ['sleep'],
        ai_enabled: false,
        status: 'archived',
        updated_at: '2026-04-22T16:00:00+00:00',
        archived_at: '2026-04-22T16:00:00+00:00',
      },
    });

    let tree;
    await act(async () => {
      tree = renderer.create(
        <CoachPanelHost
          accessToken="token"
          activePanel="note"
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

    await act(async () => {
      tree.root.findByProps({ testID: 'trainer-coach-knowledge-archive-entry-1' }).props.onPress({
        stopPropagation: jest.fn(),
      });
    });

    expect(() => tree.root.findByProps({ testID: 'trainer-coach-knowledge-archive-confirm-dialog' })).not.toThrow();
    await act(async () => {
      tree.unmount();
    });
  });

  it('rolls back optimistic create on save failure', async () => {
    listTrainerKnowledgeEntries.mockResolvedValueOnce([
      {
        id: 'entry-existing',
        title: 'Existing note',
        raw_content: 'Existing knowledge note.',
        knowledge_type: 'coaching_rule',
        scope: 'global',
        tags: [],
        ai_enabled: true,
        status: 'active',
        updated_at: '2026-04-22T16:00:00+00:00',
      },
    ]);
    createTrainerKnowledgeEntry.mockRejectedValueOnce(new Error('Save failed'));

    let tree;
    await act(async () => {
      tree = renderer.create(
        <CoachPanelHost
          accessToken="token"
          activePanel="note"
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

    const rowsBefore = tree.root.findAll((node) => (
      typeof node.props?.testID === 'string'
      && node.props.testID.startsWith('trainer-coach-knowledge-row-')
    ));

    await act(async () => {
      tree.root.findByProps({ testID: 'trainer-coach-knowledge-open-new' }).props.onPress();
    });

    await act(async () => {
      tree.root.findByProps({ testID: 'trainer-coach-knowledge-raw-input' }).props.onChangeText(
        'New note should optimistically appear and then roll back.',
      );
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'trainer-coach-knowledge-save' }).props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(hasText(tree, 'Save failed')).toBe(true);
    const rows = tree.root.findAll((node) => (
      typeof node.props?.testID === 'string'
      && node.props.testID.startsWith('trainer-coach-knowledge-row-')
    ));
    expect(rows).toHaveLength(rowsBefore.length);

    await act(async () => {
      tree.unmount();
    });
  });

  it('matches small-screen /note snapshot without filter wrapping regressions', async () => {
    listTrainerKnowledgeEntries.mockResolvedValueOnce([
      {
        id: 'entry-1',
        title: 'Sleep adjustment',
        raw_content: 'When sleep is poor, reduce intensity and prioritize movement quality.',
        knowledge_type: 'coaching_rule',
        scope: 'global',
        tags: ['sleep'],
        ai_enabled: true,
        status: 'active',
        updated_at: '2026-04-22T16:00:00+00:00',
      },
    ]);

    let tree;
    await act(async () => {
      tree = renderer.create(
        <View style={{ width: 320, height: 568 }}>
          <CoachPanelHost
            accessToken="token"
            activePanel="note"
            panelContext={null}
            queue={buildQueue()}
            onClose={jest.fn()}
            onOpenTrainerCoach={jest.fn()}
            onApproveDraft={jest.fn()}
            onEditDraft={jest.fn()}
            onRejectDraft={jest.fn()}
            onSystemEvent={jest.fn()}
          />
        </View>,
      );
    });
    await flushEffects();

    expect(tree.toJSON()).toMatchSnapshot();

    await act(async () => {
      tree.unmount();
    });
  });

  it('lifts the sheet above the keyboard and resets when keyboard closes', async () => {
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

    let sheet = tree.root.findByProps({ testID: 'trainer-coach-panel-sheet' });
    let flattenedStyle = StyleSheet.flatten(sheet.props.style);
    expect(flattenedStyle.marginBottom).toBe(0);

    act(() => {
      keyboardListeners[openEventName]?.({
        endCoordinates: { height: 220 },
      });
    });

    sheet = tree.root.findByProps({ testID: 'trainer-coach-panel-sheet' });
    flattenedStyle = StyleSheet.flatten(sheet.props.style);
    expect(flattenedStyle.marginBottom).toBeGreaterThan(220);

    act(() => {
      keyboardListeners[closeEventName]?.();
    });

    sheet = tree.root.findByProps({ testID: 'trainer-coach-panel-sheet' });
    flattenedStyle = StyleSheet.flatten(sheet.props.style);
    expect(flattenedStyle.marginBottom).toBe(0);

    await act(async () => {
      tree.unmount();
    });
  });

  it('cleans up keyboard listeners when panel closes and when component unmounts', async () => {
    const sharedProps = {
      accessToken: 'token',
      panelContext: null,
      queue: buildQueue(),
      onClose: jest.fn(),
      onOpenTrainerCoach: jest.fn(),
      onApproveDraft: jest.fn(),
      onEditDraft: jest.fn(),
      onRejectDraft: jest.fn(),
      onSystemEvent: jest.fn(),
    };

    let tree;
    await act(async () => {
      tree = renderer.create(
        <CoachPanelHost
          {...sharedProps}
          activePanel="program"
        />,
      );
    });
    await flushEffects();

    const closeCleanupRemovers = [...keyboardRemoveMocks];
    expect(closeCleanupRemovers).toHaveLength(2);

    await act(async () => {
      tree.update(
        <CoachPanelHost
          {...sharedProps}
          activePanel={null}
        />,
      );
    });
    closeCleanupRemovers.forEach((removeMock) => {
      expect(removeMock).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      tree.unmount();
    });

    let secondTree;
    await act(async () => {
      secondTree = renderer.create(
        <CoachPanelHost
          {...sharedProps}
          activePanel="program"
        />,
      );
    });
    await flushEffects();

    const unmountCleanupRemovers = keyboardRemoveMocks.slice(2);
    expect(unmountCleanupRemovers).toHaveLength(2);

    await act(async () => {
      secondTree.unmount();
    });
    unmountCleanupRemovers.forEach((removeMock) => {
      expect(removeMock).toHaveBeenCalledTimes(1);
    });
  });
});

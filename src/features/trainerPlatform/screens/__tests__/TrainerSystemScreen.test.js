jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaProvider: ({ children }) => children,
    SafeAreaView: ({ children }) => React.createElement('SafeAreaView', null, children),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

jest.mock('../../../../services/apiBaseUrl', () => ({
  getApiDebugInfo: jest.fn(() => ({
    resolvedApiBaseUrl: 'http://127.0.0.1:8000',
  })),
}));

jest.mock('../../../../services/apiRequest', () => ({
  fetchWithApiFallback: jest.fn(),
}));

jest.mock('../../../trainerHome/services/trainerKnowledgeApi', () => ({
  archiveTrainerRule: jest.fn().mockResolvedValue({}),
  createTrainerKnowledgeDocument: jest.fn().mockResolvedValue({}),
  deleteTrainerKnowledgeDocument: jest.fn().mockResolvedValue({}),
  listTrainerKnowledgeDocuments: jest.fn(),
  listTrainerRules: jest.fn().mockResolvedValue([]),
  saveTrainerKnowledgeDocumentWithFallback: jest.fn().mockResolvedValue({
    extraction: { rules_created: 0, fallback_reason: null },
  }),
  updateTrainerKnowledgeDocument: jest.fn().mockResolvedValue({}),
  updateTrainerRule: jest.fn().mockResolvedValue({}),
}));

jest.mock('../../../trainerClients/services/trainerHomeApi', () => ({
  createTrainerInviteCode: jest.fn().mockResolvedValue({
    id: 'invite-1',
    code: 'MODE1234',
    is_active: true,
  }),
  deactivateTrainerInviteCode: jest.fn().mockResolvedValue({
    id: 'invite-1',
    code: 'MODE1234',
    is_active: false,
  }),
  getTrainerClientAIContext: jest.fn().mockResolvedValue({
    context_preview_text: 'Taylor responds well to concise coaching prompts.',
  }),
  getTrainerClientDetail: jest.fn().mockResolvedValue({
    client: {
      client_id: 'client-1',
      client_name: 'Taylor',
    },
    profile_snapshot: {
      primary_goal: 'Build strength',
      onboarding_status: 'active',
      experience_level: 'intermediate',
      current_mode: 'BUILD',
    },
    activity_summary: {
      latest_checkin_date: '2026-04-19',
      workouts_completed_7d: 3,
      checkins_completed_7d: 4,
      meeting_location: 'HQ Gym',
      session_start_at: '2026-04-20T17:00:00.000Z',
    },
    memory_counts: {
      total: 4,
      ai_usable: 2,
      internal_only: 2,
    },
    schedule_preferences: {
      recurring_weekdays: [1, 3],
      preferred_meeting_location: 'HQ Gym',
      auto_use_trainer_default_location: true,
      upcoming_exceptions: [],
    },
  }),
  listTrainerClients: jest.fn(),
  listTrainerInviteCodes: jest.fn().mockResolvedValue({ items: [], count: 0 }),
  removeTrainerClient: jest.fn().mockResolvedValue({ client_id: 'client-1' }),
  updateTrainerClient: jest.fn().mockResolvedValue({ client_id: 'client-1', client_name: 'Taylor Swift' }),
}));

jest.mock('../../../profile/services/profileApi', () => ({
  getTrainerSettingsMe: jest.fn(),
  patchTrainerSettingsMe: jest.fn().mockResolvedValue({
    default_meeting_location: 'HQ Gym',
    auto_fill_meeting_location: true,
    assistant_display_name: 'Atlas',
  }),
}));

jest.mock('../../../trainerCoach/services/trainerCoachApi', () => ({
  approveTrainerCoachQueueItem: jest.fn().mockResolvedValue({}),
  editTrainerCoachQueueItem: jest.fn().mockResolvedValue({}),
  getTrainerCoachQueue: jest.fn(),
  rejectTrainerCoachQueueItem: jest.fn().mockResolvedValue({}),
}));

jest.mock('../../../trainerReview/services/trainerReviewApi', () => ({
  approveTrainerReviewOutput: jest.fn().mockResolvedValue({}),
  editTrainerReviewOutput: jest.fn().mockResolvedValue({}),
  getTrainerReviewOutputs: jest.fn(),
  rejectTrainerReviewOutput: jest.fn().mockResolvedValue({}),
}));

jest.mock('expo-constants', () => ({
  expoConfig: {
    version: '1.2.3',
  },
}));

import React from 'react';
import renderer, { act } from 'react-test-renderer';

import { fetchWithApiFallback } from '../../../../services/apiRequest';
import { listTrainerKnowledgeDocuments } from '../../../trainerHome/services/trainerKnowledgeApi';
import {
  deactivateTrainerInviteCode,
  listTrainerClients,
  listTrainerInviteCodes,
} from '../../../trainerClients/services/trainerHomeApi';
import { getTrainerSettingsMe } from '../../../profile/services/profileApi';
import { getTrainerCoachQueue } from '../../../trainerCoach/services/trainerCoachApi';
import { getTrainerReviewOutputs } from '../../../trainerReview/services/trainerReviewApi';
import TrainerSystemScreen from '../TrainerSystemScreen';

function createJsonResponse(payload = {}, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: jest.fn().mockResolvedValue(payload),
    headers: {
      get: jest.fn(() => null),
    },
  };
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function findPressableByTestID(root, testID) {
  return root.find(
    (node) => node.props?.testID === testID && typeof node.props?.onPress === 'function',
  );
}

function findBackButton(root) {
  return root.find(
    (node) => node.props?.accessibilityLabel === 'Go back' && typeof node.props?.onPress === 'function',
  );
}

describe('TrainerSystemScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    listTrainerInviteCodes.mockResolvedValue({ items: [], count: 0 });
    deactivateTrainerInviteCode.mockResolvedValue({
      id: 'invite-1',
      code: 'MODE1234',
      is_active: false,
    });
    listTrainerKnowledgeDocuments.mockResolvedValue([
      { id: 'doc-1', title: 'Methodology' },
      { id: 'doc-2', title: 'Quick Capture' },
    ]);
    listTrainerClients.mockResolvedValue({
      count: 3,
      items: [
        { client_id: 'client-1', client_name: 'Taylor', user_id: 'client-user-1' },
        { client_id: 'client-2', client_name: 'Jordan', user_id: 'client-user-2' },
      ],
    });
    getTrainerSettingsMe.mockResolvedValue({
      default_meeting_location: 'HQ Gym',
      auto_fill_meeting_location: true,
      assistant_display_name: 'Atlas',
    });
    getTrainerCoachQueue.mockResolvedValue({
      count: 1,
      items: [
        {
          output_id: 'draft-1',
          client_name: 'Taylor',
          summary: 'Reduce load this week.',
          headline: 'Adjust plan',
          priority_tier: 'high',
          output_text: 'Reduce load this week.',
        },
      ],
    });
    getTrainerReviewOutputs.mockResolvedValue({
      count: 2,
      items: [
        { id: 'output-1', output_text: 'Open output 1', source_type: 'chat', review_status: 'open' },
        { id: 'output-2', output_text: 'Open output 2', source_type: 'chat', review_status: 'open' },
      ],
    });
    fetchWithApiFallback.mockImplementation((path) => {
      if (path === '/api/v1/trainer-review/queue') {
        return Promise.resolve({
          response: createJsonResponse([
            {
              id: 'qa-1',
              user_question: 'How do I stay consistent?',
              model_draft_answer: 'Start with a smaller target.',
              confidence_score: 0.42,
              status: 'open',
            },
          ]),
        });
      }
      return Promise.resolve({
        response: createJsonResponse({}),
      });
    });
  });

  async function renderScreen(overrides = {}) {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <TrainerSystemScreen
          accessToken="trainer-token"
          bottomInset={12}
          assignmentStatus={{
            viewer_display_name: 'Coach Maya',
            trainer_onboarding_completed: true,
            trainer_onboarding_status: 'completed',
            trainer_onboarding_completed_steps: 8,
            trainer_onboarding_total_steps: 8,
            ...overrides.assignmentStatus,
          }}
          session={{
            user: { email: 'maya@example.com' },
          }}
          onSignOut={jest.fn()}
          onOpenTrainerCoach={overrides.onOpenTrainerCoach || jest.fn()}
        />,
      );
    });
    await flushEffects();
    return tree;
  }

  it('renders the compact trainer system hub and loads summary counts', async () => {
    const tree = await renderScreen();
    const rendered = JSON.stringify(tree.toJSON());

    expect(rendered).toContain('System');
    expect(rendered).toContain('Coach Profile');
    expect(rendered).toContain('Memory Bank');
    expect(rendered).toContain('Review Hub');
    expect(rendered).toContain('Coach Maya');
    expect(rendered).toContain('Atlas is calibrated and ready for trainer-controlled coaching.');

    expect(listTrainerKnowledgeDocuments).toHaveBeenCalledWith({ accessToken: 'trainer-token' });
    expect(listTrainerClients).toHaveBeenCalledWith({
      accessToken: 'trainer-token',
      limit: 1,
      offset: 0,
    });
    expect(getTrainerCoachQueue).toHaveBeenCalledWith({ accessToken: 'trainer-token', limit: 50 });
    expect(getTrainerReviewOutputs).toHaveBeenCalledWith({
      accessToken: 'trainer-token',
      status: 'open',
      limit: 50,
      offset: 0,
    });
    expect(fetchWithApiFallback).toHaveBeenCalledWith(
      '/api/v1/trainer-review/queue',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('navigates into review/retrain and preserves coach launch payloads', async () => {
    const onOpenTrainerCoach = jest.fn();
    const tree = await renderScreen({
      onOpenTrainerCoach,
      assignmentStatus: {
        trainer_onboarding_completed: false,
        trainer_onboarding_status: 'in_progress',
        trainer_onboarding_completed_steps: 3,
        trainer_onboarding_total_steps: 8,
      },
    });

    await act(async () => {
      findPressableByTestID(tree.root, 'trainer-system-nav-coach-retrain-review').props.onPress();
    });

    expect(JSON.stringify(tree.toJSON())).toContain('Review / Retrain');

    await act(async () => {
      findPressableByTestID(tree.root, 'trainer-system-coach-review-button').props.onPress();
    });
    await act(async () => {
      findPressableByTestID(tree.root, 'trainer-system-coach-retrain-button').props.onPress();
    });

    expect(onOpenTrainerCoach).toHaveBeenNthCalledWith(1, {
      entrypoint: 'trainer_agent_training',
      onboarding_action: 'review',
    });
    expect(onOpenTrainerCoach).toHaveBeenNthCalledWith(2, {
      entrypoint: 'trainer_agent_training',
      onboarding_action: 'retrain',
    });
  });

  it('drills into client list and client detail, then supports back navigation', async () => {
    const tree = await renderScreen();

    await act(async () => {
      findPressableByTestID(tree.root, 'trainer-system-nav-clients-list').props.onPress();
    });
    await flushEffects();

    expect(JSON.stringify(tree.toJSON())).toContain('Client List');
    expect(JSON.stringify(tree.toJSON())).toContain('Taylor');

    await act(async () => {
      findPressableByTestID(tree.root, 'trainer-system-client-row-client-1').props.onPress();
    });
    await flushEffects();

    const detailRendered = JSON.stringify(tree.toJSON());
    expect(detailRendered).toContain('Client detail management');
    expect(detailRendered).toContain('Build strength');
    expect(detailRendered).toContain('Taylor responds well to concise coaching prompts.');

    await act(async () => {
      findBackButton(tree.root).props.onPress();
    });

    expect(JSON.stringify(tree.toJSON())).toContain('Client List');
  });

  it('hides inactive invite codes and removes a row after deactivate in client management', async () => {
    listTrainerInviteCodes.mockResolvedValue({
      count: 2,
      items: [
        { id: 'invite-active', code: 'MODEACTIVE', is_active: true },
        { id: 'invite-1', code: 'MODEOLD', is_active: false },
      ],
    });
    deactivateTrainerInviteCode.mockResolvedValue({
      id: 'invite-active',
      code: 'MODEACTIVE',
      is_active: false,
    });

    const tree = await renderScreen();
    await act(async () => {
      findPressableByTestID(tree.root, 'trainer-system-nav-client-management').props.onPress();
    });
    await flushEffects();

    let rendered = JSON.stringify(tree.toJSON());
    expect(rendered).toContain('MODEACTIVE');
    expect(rendered).not.toContain('MODEOLD');

    await act(async () => {
      findPressableByTestID(tree.root, 'trainer-system-invite-deactivate-invite-active').props.onPress();
    });
    await flushEffects();

    expect(deactivateTrainerInviteCode).toHaveBeenCalledWith({
      accessToken: 'trainer-token',
      inviteId: 'invite-active',
    });
    rendered = JSON.stringify(tree.toJSON());
    expect(rendered).not.toContain('MODEACTIVE');
  });

  it('shows Pending user only in Client Management assigned clients list', async () => {
    listTrainerClients.mockResolvedValue({
      count: 2,
      items: [
        { client_id: 'client-1', client_name: 'Taylor', user_id: 'client-user-1', is_pending_user: true },
        { client_id: 'client-2', client_name: 'Jordan', user_id: 'client-user-2', is_pending_user: false },
      ],
    });

    const tree = await renderScreen();
    await act(async () => {
      findPressableByTestID(tree.root, 'trainer-system-nav-client-management').props.onPress();
    });
    await flushEffects();

    let rendered = JSON.stringify(tree.toJSON());
    expect(rendered).toContain('Pending user');
    expect(rendered).toContain('Jordan');
    expect(rendered).not.toContain('Taylor');

    await act(async () => {
      findBackButton(tree.root).props.onPress();
    });
    await act(async () => {
      findPressableByTestID(tree.root, 'trainer-system-nav-clients-list').props.onPress();
    });
    await flushEffects();

    rendered = JSON.stringify(tree.toJSON());
    expect(rendered).toContain('Taylor');
    expect(rendered).not.toContain('Pending user');
  });
});

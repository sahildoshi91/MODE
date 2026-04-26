import React, { useEffect } from 'react';
import renderer, { act } from 'react-test-renderer';

jest.mock('../../../trainerAssistant/services/trainerAssistantApi', () => ({
  executeTrainerAssistantAction: jest.fn(),
  executeTrainerAssistantActionStream: jest.fn(),
}));

jest.mock('../../services/trainerCoachApi', () => ({
  approveTrainerCoachQueueItem: jest.fn(),
  createTrainerCoachEvent: jest.fn(),
  editTrainerCoachQueueItem: jest.fn(),
  getTrainerCoachWorkspace: jest.fn(),
  rejectTrainerCoachQueueItem: jest.fn(),
}));

jest.mock('../../storage/trainerCoachStorage', () => ({
  loadTrainerCoachPendingOps: jest.fn(),
  loadTrainerCoachWorkspaceCache: jest.fn(),
  saveTrainerCoachPendingOps: jest.fn(),
  saveTrainerCoachWorkspaceCache: jest.fn(),
}));

jest.mock('../../../trainerHome/services/trainerKnowledgeApi', () => ({
  createTrainerKnowledgeEntry: jest.fn(),
}));

import {
  createTrainerCoachEvent,
  getTrainerCoachWorkspace,
} from '../../services/trainerCoachApi';
import {
  executeTrainerAssistantAction,
  executeTrainerAssistantActionStream,
} from '../../../trainerAssistant/services/trainerAssistantApi';
import {
  loadTrainerCoachPendingOps,
  loadTrainerCoachWorkspaceCache,
  saveTrainerCoachPendingOps,
  saveTrainerCoachWorkspaceCache,
} from '../../storage/trainerCoachStorage';
import { createTrainerKnowledgeEntry } from '../../../trainerHome/services/trainerKnowledgeApi';
import { useTrainerCoachWorkspace } from '../useTrainerCoachWorkspace';

function buildWorkspacePayload() {
  return {
    generated_at: '2026-04-18T12:00:00.000Z',
    summary: {
      state: 'drafts_pending',
      title: '1 drafts pending review',
      subtitle: 'Resolve pending drafts.',
      actions: [],
      counts: {
        drafts_pending: 1,
      },
    },
    queue: [
      {
        output_id: 'output-1',
        trainer_id: 'trainer-1',
        client_id: 'client-1',
        client_name: 'Sarah',
        source_type: 'chat',
        review_status: 'open',
        queue_state: 'pending',
        priority_tier: 'high',
        queue_priority: 10,
        delivery_state: 'draft',
        action_type: 'adjust_plan',
        headline: 'Adjust plan',
        summary: 'Reduce intensity this week.',
        output_text: 'Reduce intensity this week.',
        output_json: { summary: 'Reduce intensity this week.' },
        reviewed_output_text: null,
        reviewed_output_json: null,
        created_at: '2026-04-18T10:00:00.000Z',
        updated_at: '2026-04-18T10:00:00.000Z',
      },
    ],
    events: [],
    sync: {
      pending_operation_count: 0,
      failed_operation_count: 0,
    },
  };
}

function HookHarness({ accessToken, trainerId, onSnapshot }) {
  const snapshot = useTrainerCoachWorkspace({
    accessToken,
    trainerId,
  });

  useEffect(() => {
    onSnapshot(snapshot);
  }, [onSnapshot, snapshot]);

  return null;
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useTrainerCoachWorkspace', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    loadTrainerCoachWorkspaceCache.mockResolvedValue(null);
    loadTrainerCoachPendingOps.mockResolvedValue([]);
    saveTrainerCoachWorkspaceCache.mockResolvedValue(undefined);
    saveTrainerCoachPendingOps.mockResolvedValue(undefined);
    getTrainerCoachWorkspace.mockResolvedValue(buildWorkspacePayload());
    executeTrainerAssistantActionStream.mockRejectedValue(new Error('stream unavailable'));
    executeTrainerAssistantAction.mockResolvedValue({
      draft_id: 'draft-1',
      output: {
        action_type: 'adjust_plan',
        headline: 'Draft Ready',
        summary: 'Draft generated.',
      },
    });
    createTrainerKnowledgeEntry.mockResolvedValue({
      entry: {
        id: 'entry-1',
        scope: 'global',
        type: 'note',
        source: 'slash_command',
      },
    });
    createTrainerCoachEvent.mockResolvedValue({
      id: 'evt-1',
      event_type: 'rule_updated',
      message: 'Rule updated',
      severity: 'success',
      visibility: 'system',
      status: 'confirmed',
      output_id: null,
      client_id: 'client-1',
      payload: { source: 'test' },
      created_at: '2026-04-18T12:01:00.000Z',
      updated_at: '2026-04-18T12:01:00.000Z',
    });
  });

  it('routes primary and legacy slash commands to /client and /note surfaces', async () => {
    let latestSnapshot = null;
    const onSnapshot = (snapshot) => {
      latestSnapshot = snapshot;
    };

    await act(async () => {
      renderer.create(
        <HookHarness
          accessToken="trainer-token"
          trainerId="trainer-1"
          onSnapshot={onSnapshot}
        />,
      );
    });
    await flushEffects();

    await act(async () => {
      await latestSnapshot.actions.sendIntentMessage('/client');
    });
    await flushEffects();
    expect(latestSnapshot.state.panels.active).toBe('client_context');
    expect(latestSnapshot.state.panels.context).toEqual(expect.objectContaining({
      clientId: 'client-1',
      initialSection: 'quick_note',
    }));

    await act(async () => {
      await latestSnapshot.actions.sendIntentMessage('/note');
    });
    await flushEffects();
    expect(latestSnapshot.state.panels.active).toBe('note');

    await act(async () => {
      await latestSnapshot.actions.sendIntentMessage('/memory');
    });
    await flushEffects();
    expect(latestSnapshot.state.panels.active).toBe('client_context');
    expect(latestSnapshot.state.panels.context).toEqual(expect.objectContaining({
      clientId: 'client-1',
      initialSection: 'quick_note',
    }));
    let stream = latestSnapshot.state.stream;
    let lastItem = stream[stream.length - 1];
    expect(lastItem.kind).toBe('internal_ai_private');
    expect(lastItem.text).toContain('/client');

    await act(async () => {
      await latestSnapshot.actions.sendIntentMessage('/flag');
    });
    await flushEffects();
    expect(latestSnapshot.state.panels.active).toBe('client_context');
    expect(latestSnapshot.state.panels.context).toEqual(expect.objectContaining({
      clientId: 'client-1',
      filter: 'risk_flags',
      initialSection: 'settings',
    }));
    stream = latestSnapshot.state.stream;
    lastItem = stream[stream.length - 1];
    expect(lastItem.kind).toBe('internal_ai_private');
    expect(lastItem.text).toContain('/client');

    await act(async () => {
      await latestSnapshot.actions.sendIntentMessage('/program');
    });
    await flushEffects();
    expect(latestSnapshot.state.panels.active).toBe('note');
    stream = latestSnapshot.state.stream;
    lastItem = stream[stream.length - 1];
    expect(lastItem.kind).toBe('internal_ai_private');
    expect(lastItem.text).toContain('/note');

    await act(async () => {
      await latestSnapshot.actions.sendIntentMessage('/rules');
    });
    await flushEffects();
    expect(latestSnapshot.state.panels.active).toBe('note');
    stream = latestSnapshot.state.stream;
    lastItem = stream[stream.length - 1];
    expect(lastItem.kind).toBe('internal_ai_private');
    expect(lastItem.text).toContain('/note');
  });

  it('intercepts /note capture commands and saves knowledge without running assistant execute', async () => {
    let latestSnapshot = null;
    const onSnapshot = (snapshot) => {
      latestSnapshot = snapshot;
    };

    await act(async () => {
      renderer.create(
        <HookHarness
          accessToken="trainer-token"
          trainerId="trainer-1"
          onSnapshot={onSnapshot}
        />,
      );
    });
    await flushEffects();

    await act(async () => {
      await latestSnapshot.actions.sendIntentMessage('/note Keep protein high before increasing calories.');
    });
    await flushEffects();

    expect(createTrainerKnowledgeEntry).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'trainer-token',
      body: 'Keep protein high before increasing calories.',
      type: 'note',
      scope: 'global',
      source: 'slash_command',
      clientId: null,
    }));
    expect(executeTrainerAssistantActionStream).not.toHaveBeenCalled();
    expect(executeTrainerAssistantAction).not.toHaveBeenCalled();
    expect(latestSnapshot.state.ui.toast).toEqual(expect.objectContaining({
      message: 'Saved to Coaching Knowledge',
      tone: 'success',
    }));
  });

  it('opens client-note composer when /clientnote has no selected client', async () => {
    getTrainerCoachWorkspace.mockResolvedValueOnce({
      ...buildWorkspacePayload(),
      queue: [],
    });

    let latestSnapshot = null;
    const onSnapshot = (snapshot) => {
      latestSnapshot = snapshot;
    };

    await act(async () => {
      renderer.create(
        <HookHarness
          accessToken="trainer-token"
          trainerId="trainer-1"
          onSnapshot={onSnapshot}
        />,
      );
    });
    await flushEffects();

    await act(async () => {
      await latestSnapshot.actions.sendIntentMessage('/clientnote Track readiness and sleep consistency.');
    });
    await flushEffects();

    expect(createTrainerKnowledgeEntry).not.toHaveBeenCalled();
    expect(latestSnapshot.state.panels.active).toBe('note');
    expect(latestSnapshot.state.panels.context).toEqual(expect.objectContaining({
      initialDraft: expect.objectContaining({
        body: 'Track readiness and sleep consistency.',
        scope: 'client',
        type: 'note',
        source: 'slash_command',
      }),
    }));
    expect(latestSnapshot.state.ui.toast).toEqual(expect.objectContaining({
      message: 'Select a client to save this note.',
      tone: 'warning',
    }));
  });

  it('treats escaped capture commands as literal trainer text for assistant execution', async () => {
    let latestSnapshot = null;
    const onSnapshot = (snapshot) => {
      latestSnapshot = snapshot;
    };

    await act(async () => {
      renderer.create(
        <HookHarness
          accessToken="trainer-token"
          trainerId="trainer-1"
          onSnapshot={onSnapshot}
        />,
      );
    });
    await flushEffects();

    await act(async () => {
      await latestSnapshot.actions.sendIntentMessage('\\/note Keep this as normal chat text.');
    });
    await flushEffects();

    expect(createTrainerKnowledgeEntry).not.toHaveBeenCalled();
    expect(executeTrainerAssistantActionStream).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'trainer-token',
      message: '/note Keep this as normal chat text.',
      clientId: 'client-1',
    }));
  });

  it('marks unknown slash commands as failed system confirmations', async () => {
    let latestSnapshot = null;
    const onSnapshot = (snapshot) => {
      latestSnapshot = snapshot;
    };

    await act(async () => {
      renderer.create(
        <HookHarness
          accessToken="trainer-token"
          trainerId="trainer-1"
          onSnapshot={onSnapshot}
        />,
      );
    });
    await flushEffects();

    await act(async () => {
      await latestSnapshot.actions.sendIntentMessage('/unknown-command');
    });
    await flushEffects();

    const stream = latestSnapshot.state.stream;
    const lastItem = stream[stream.length - 1];
    expect(lastItem.kind).toBe('system_confirmation');
    expect(lastItem.status).toBe('failed');
    expect(lastItem.severity).toBe('warning');
    expect(lastItem.text).toContain('Unknown command');
  });

  it('keeps /drafts as a legacy alias that redirects to /client settings with a visible hint', async () => {
    let latestSnapshot = null;
    const onSnapshot = (snapshot) => {
      latestSnapshot = snapshot;
    };

    await act(async () => {
      renderer.create(
        <HookHarness
          accessToken="trainer-token"
          trainerId="trainer-1"
          onSnapshot={onSnapshot}
        />,
      );
    });
    await flushEffects();

    await act(async () => {
      await latestSnapshot.actions.sendIntentMessage('/drafts');
    });
    await flushEffects();

    expect(latestSnapshot.state.panels.active).toBe('client_context');
    expect(latestSnapshot.state.panels.context).toEqual(expect.objectContaining({
      clientId: 'client-1',
      initialSection: 'settings',
    }));
    const stream = latestSnapshot.state.stream;
    const lastItem = stream[stream.length - 1];
    expect(lastItem.kind).toBe('internal_ai_private');
    expect(lastItem.status).toBe('confirmed');
    expect(lastItem.text).toContain('/client');
  });

  it('handles rapid /client invocation without injecting slash chips into trainer_input stream items', async () => {
    let latestSnapshot = null;
    const onSnapshot = (snapshot) => {
      latestSnapshot = snapshot;
    };

    await act(async () => {
      renderer.create(
        <HookHarness
          accessToken="trainer-token"
          trainerId="trainer-1"
          onSnapshot={onSnapshot}
        />,
      );
    });
    await flushEffects();

    await act(async () => {
      await Promise.all([
        latestSnapshot.actions.sendIntentMessage('/client'),
        latestSnapshot.actions.sendIntentMessage('/client'),
      ]);
    });
    await flushEffects();

    const slashTrainerInputs = latestSnapshot.state.stream.filter(
      (item) => item.kind === 'trainer_input' && item.text === '/client',
    );
    expect(slashTrainerInputs).toHaveLength(0);
    expect(latestSnapshot.state.panels.active).toBe('client_context');
  });

  it('includes active client id metadata in assistant execute requests', async () => {
    let latestSnapshot = null;
    const onSnapshot = (snapshot) => {
      latestSnapshot = snapshot;
    };

    await act(async () => {
      renderer.create(
        <HookHarness
          accessToken="trainer-token"
          trainerId="trainer-1"
          onSnapshot={onSnapshot}
        />,
      );
    });
    await flushEffects();

    await act(async () => {
      await latestSnapshot.actions.sendIntentMessage('Draft a check-in follow-up.');
    });
    await flushEffects();

    expect(executeTrainerAssistantActionStream).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'trainer-token',
      clientId: 'client-1',
      message: 'Draft a check-in follow-up.',
    }));
    expect(executeTrainerAssistantAction).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'trainer-token',
      clientId: 'client-1',
      message: 'Draft a check-in follow-up.',
    }));
  });

  it('persists system confirmations through trainer-coach events API', async () => {
    let latestSnapshot = null;
    const onSnapshot = (snapshot) => {
      latestSnapshot = snapshot;
    };

    await act(async () => {
      renderer.create(
        <HookHarness
          accessToken="trainer-token"
          trainerId="trainer-1"
          onSnapshot={onSnapshot}
        />,
      );
    });
    await flushEffects();

    await act(async () => {
      await latestSnapshot.actions.emitSystemEvent({
        eventKey: 'rule-updated-1',
        eventType: 'rule_updated',
        message: 'Rule updated',
        severity: 'success',
        visibility: 'system',
        clientId: 'client-1',
        payload: { source: 'panel_rules' },
      });
    });
    await flushEffects();

    expect(createTrainerCoachEvent).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'trainer-token',
      eventKey: 'rule-updated-1',
      eventType: 'rule_updated',
      message: 'Rule updated',
      clientId: 'client-1',
    }));
    expect(getTrainerCoachWorkspace).toHaveBeenCalledTimes(2);

    const stream = latestSnapshot.state.stream;
    const persistedEvent = stream.find((item) => item.id === 'event-evt-1');
    expect(persistedEvent).toEqual(expect.objectContaining({
      kind: 'system_confirmation',
      text: 'Rule updated',
      visibility: 'system',
      status: 'confirmed',
    }));
  });

  it('captures structured stale-route metadata when workspace endpoint is missing', async () => {
    getTrainerCoachWorkspace.mockRejectedValueOnce({
      message: 'Not found',
      status: 404,
      request_path: '/api/v1/trainer-coach/workspace',
      api_base_url: 'http://127.0.0.1:8000',
      attempted_base_urls: ['http://127.0.0.1:8000', 'http://192.168.6.137:8000'],
      failover_attempted: true,
      failover_applied: true,
      is_missing_trainer_route: true,
    });

    let latestSnapshot = null;
    const onSnapshot = (snapshot) => {
      latestSnapshot = snapshot;
    };

    await act(async () => {
      renderer.create(
        <HookHarness
          accessToken="trainer-token"
          trainerId="trainer-1"
          onSnapshot={onSnapshot}
        />,
      );
    });
    await flushEffects();

    expect(latestSnapshot.state.error).toBe('Not found');
    expect(latestSnapshot.state.errorDetails).toEqual(expect.objectContaining({
      status: 404,
      requestPath: '/api/v1/trainer-coach/workspace',
      apiBase: 'http://127.0.0.1:8000',
      attemptedBaseUrls: ['http://127.0.0.1:8000', 'http://192.168.6.137:8000'],
      failoverAttempted: true,
      failoverApplied: true,
      isStaleBackendRoute: true,
    }));
  });

  it('captures connectivity probe metadata when workspace endpoint is unreachable', async () => {
    getTrainerCoachWorkspace.mockRejectedValueOnce({
      message: 'Unable to reach the backend for /api/v1/trainer-coach/workspace.',
      stage: 'network',
      path: '/api/v1/trainer-coach/workspace',
      resolved_api_base_url: 'http://192.168.6.137:8000',
      attempted_base_urls: ['http://192.168.6.137:8000', 'http://192.168.6.144:8000'],
      failover_attempted: true,
      failover_applied: false,
      connectivity_probe: {
        endpoint_path: '/healthz',
        first_reachable_base_url: 'http://192.168.6.144:8000',
        candidate_api_base_urls: ['http://192.168.6.137:8000', 'http://192.168.6.144:8000'],
        attempts: [],
      },
      recommended_api_base_url: 'http://192.168.6.144:8000',
    });

    let latestSnapshot = null;
    const onSnapshot = (snapshot) => {
      latestSnapshot = snapshot;
    };

    await act(async () => {
      renderer.create(
        <HookHarness
          accessToken="trainer-token"
          trainerId="trainer-1"
          onSnapshot={onSnapshot}
        />,
      );
    });
    await flushEffects();

    expect(latestSnapshot.state.errorDetails).toEqual(expect.objectContaining({
      stage: 'network',
      requestPath: '/api/v1/trainer-coach/workspace',
      apiBase: 'http://192.168.6.137:8000',
      attemptedBaseUrls: ['http://192.168.6.137:8000', 'http://192.168.6.144:8000'],
      recommendedApiBase: 'http://192.168.6.144:8000',
      connectivityProbe: expect.objectContaining({
        endpoint_path: '/healthz',
        first_reachable_base_url: 'http://192.168.6.144:8000',
      }),
      isStaleBackendRoute: false,
    }));
  });

  it('surfaces detailed assistant execute diagnostics in composer stream failures', async () => {
    executeTrainerAssistantAction.mockRejectedValueOnce({
      message: 'Unable to reach the backend for /api/v1/trainer-assistant/execute.',
      stage: 'network',
      path: '/api/v1/trainer-assistant/execute',
      request_path: '/api/v1/trainer-assistant/execute',
      api_base_url: 'http://192.168.6.137:8000',
      recommended_api_base_url: 'http://192.168.6.144:8000',
      connectivity_probe: {
        endpoint_path: '/healthz',
        first_reachable_base_url: 'http://192.168.6.144:8000',
        candidate_api_base_urls: ['http://192.168.6.137:8000', 'http://192.168.6.144:8000'],
        attempts: [],
      },
    });

    let latestSnapshot = null;
    const onSnapshot = (snapshot) => {
      latestSnapshot = snapshot;
    };

    await act(async () => {
      renderer.create(
        <HookHarness
          accessToken="trainer-token"
          trainerId="trainer-1"
          onSnapshot={onSnapshot}
        />,
      );
    });
    await flushEffects();

    await act(async () => {
      await latestSnapshot.actions.sendIntentMessage('Please draft a follow-up message.');
    });
    await flushEffects();

    const stream = latestSnapshot.state.stream;
    const lastItem = stream[stream.length - 1];
    expect(lastItem.kind).toBe('system_confirmation');
    expect(lastItem.status).toBe('failed');
    expect(lastItem.text).toContain('endpoint=/api/v1/trainer-assistant/execute');
    expect(lastItem.text).toContain('recommended_base=http://192.168.6.144:8000');
    expect(lastItem.text).toContain('Next: verify http://192.168.6.144:8000/healthz');
  });
});

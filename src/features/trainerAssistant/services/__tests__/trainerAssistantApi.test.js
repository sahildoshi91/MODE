jest.mock('../../../../services/apiRequest', () => ({
  fetchWithApiFallback: jest.fn(),
}));

jest.mock('../../../../services/apiNetworkError', () => ({
  buildApiNetworkError: jest.fn((error) => error),
}));

import { fetchWithApiFallback } from '../../../../services/apiRequest';
import {
  approveTrainerAssistantDraft,
  editTrainerAssistantDraft,
  executeTrainerAssistantAction,
  getTrainerAssistantBootstrap,
  rejectTrainerAssistantDraft,
  runTrainerAssistantBackground,
} from '../trainerAssistantApi';

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

describe('trainerAssistantApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchWithApiFallback.mockResolvedValue({
      response: createJsonResponse({ ok: true }),
      baseUrl: 'http://127.0.0.1:8000',
    });
  });

  it('calls bootstrap and execute endpoints', async () => {
    await getTrainerAssistantBootstrap({
      accessToken: 'trainer-token',
      clientId: 'client-1',
    });
    await executeTrainerAssistantAction({
      accessToken: 'trainer-token',
      clientId: 'client-1',
      actionType: 'adjust_plan',
      message: 'Adjust the next week around missed workouts.',
    });

    expect(fetchWithApiFallback).toHaveBeenNthCalledWith(
      1,
      '/api/v1/trainer-assistant/bootstrap?client_id=client-1',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer trainer-token',
        }),
      }),
    );
    expect(fetchWithApiFallback).toHaveBeenNthCalledWith(
      2,
      '/api/v1/trainer-assistant/execute',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          client_id: 'client-1',
          action_type: 'adjust_plan',
          message: 'Adjust the next week around missed workouts.',
          routing_input: null,
        }),
      }),
    );
  });

  it('calls draft mutation and background endpoints', async () => {
    await editTrainerAssistantDraft({
      accessToken: 'trainer-token',
      draftId: 'draft-1',
      editedOutputJson: { action_type: 'message_client' },
    });
    await approveTrainerAssistantDraft({
      accessToken: 'trainer-token',
      draftId: 'draft-1',
      editedOutputJson: { action_type: 'message_client' },
    });
    await rejectTrainerAssistantDraft({
      accessToken: 'trainer-token',
      draftId: 'draft-1',
      reason: 'Needs changes',
    });
    await runTrainerAssistantBackground({
      accessToken: 'trainer-token',
      runDate: '2026-04-18',
      jobs: [{ action_type: 'summarize', client_id: 'client-1', essential: true }],
    });

    expect(fetchWithApiFallback).toHaveBeenNthCalledWith(
      1,
      '/api/v1/trainer-assistant/drafts/draft-1/edit',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(fetchWithApiFallback).toHaveBeenNthCalledWith(
      2,
      '/api/v1/trainer-assistant/drafts/draft-1/approve',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(fetchWithApiFallback).toHaveBeenNthCalledWith(
      3,
      '/api/v1/trainer-assistant/drafts/draft-1/reject',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ reason: 'Needs changes' }),
      }),
    );
    expect(fetchWithApiFallback).toHaveBeenNthCalledWith(
      4,
      '/api/v1/trainer-assistant/background/run',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          run_date: '2026-04-18',
          jobs: [{ action_type: 'summarize', client_id: 'client-1', essential: true }],
        }),
      }),
    );
  });
});

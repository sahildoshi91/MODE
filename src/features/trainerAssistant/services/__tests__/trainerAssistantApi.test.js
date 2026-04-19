jest.mock('../../../../services/apiRequest', () => ({
  fetchWithApiFallback: jest.fn(),
}));

jest.mock('../../../../services/apiNetworkError', () => ({
  buildApiNetworkError: jest.fn((error, path) => ({
    ...error,
    stage: 'network',
    path,
  })),
}));

jest.mock('../../../trainerPlatform/utils/backendConnectivityProbe', () => ({
  probeBackendConnectivity: jest.fn(),
  selectRecommendedApiBaseUrl: jest.fn(),
}));

import { fetchWithApiFallback } from '../../../../services/apiRequest';
import {
  probeBackendConnectivity,
  selectRecommendedApiBaseUrl,
} from '../../../trainerPlatform/utils/backendConnectivityProbe';
import {
  approveTrainerAssistantDraft,
  editTrainerAssistantDraft,
  executeTrainerAssistantAction,
  getTrainerAssistantBootstrap,
  rejectTrainerAssistantDraft,
  runTrainerAssistantBackground,
} from '../trainerAssistantApi';

function createJsonResponse(payload = {}, { ok = true, status = 200 } = {}) {
  const responsePayload = payload;
  return {
    ok,
    status,
    json: jest.fn().mockResolvedValue(responsePayload),
    text: jest.fn().mockResolvedValue(typeof responsePayload === 'string' ? responsePayload : JSON.stringify(responsePayload)),
    clone: jest.fn(function clone() {
      return createJsonResponse(responsePayload, { ok, status });
    }),
    headers: {
      get: jest.fn(() => null),
    },
  };
}

function createTextResponse(body = '', { ok = false, status = 500 } = {}) {
  const responseBody = String(body);
  return {
    ok,
    status,
    json: jest.fn().mockRejectedValue(new Error('Invalid JSON')),
    text: jest.fn().mockResolvedValue(responseBody),
    clone: jest.fn(function clone() {
      return createTextResponse(responseBody, { ok, status });
    }),
    headers: {
      get: jest.fn(() => null),
    },
  };
}

describe('trainerAssistantApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    probeBackendConnectivity.mockResolvedValue({
      endpoint_path: '/healthz',
      timeout_ms: 1800,
      first_reachable_base_url: null,
      candidate_api_base_urls: ['http://192.168.6.137:8000', 'http://192.168.6.144:8000'],
      attempts: [],
    });
    selectRecommendedApiBaseUrl.mockReturnValue('http://192.168.6.137:8000');
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
        timeoutMs: 10000,
        shouldRetryOnResponse: expect.any(Function),
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
        timeoutMs: 60000,
        body: JSON.stringify({
          client_id: 'client-1',
          action_type: 'adjust_plan',
          message: 'Adjust the next week around missed workouts.',
          routing_input: null,
        }),
      }),
    );
    expect(fetchWithApiFallback.mock.calls[1][1].shouldRetryOnResponse).toBeUndefined();
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

  it('marks stale bootstrap responses as retryable for host failover', async () => {
    await getTrainerAssistantBootstrap({
      accessToken: 'trainer-token',
      clientId: null,
    });
    const options = fetchWithApiFallback.mock.calls[0][1];
    const shouldRetry = await options.shouldRetryOnResponse(
      createJsonResponse({ detail: 'Not found' }, { ok: false, status: 404 }),
    );

    expect(shouldRetry).toBe(true);
  });

  it('attaches failover diagnostics when bootstrap still fails after retries', async () => {
    fetchWithApiFallback.mockResolvedValueOnce({
      response: createJsonResponse({ detail: 'Not found' }, { ok: false, status: 404 }),
      baseUrl: 'http://192.168.6.137:8000',
      attemptedBaseUrls: ['http://192.168.6.137:8000', 'http://192.168.6.144:8000'],
      failoverAttempted: true,
      failoverApplied: true,
    });

    await expect(getTrainerAssistantBootstrap({
      accessToken: 'trainer-token',
      clientId: null,
    })).rejects.toEqual(expect.objectContaining({
      status: 404,
      request_path: '/api/v1/trainer-assistant/bootstrap',
      attempted_base_urls: ['http://192.168.6.137:8000', 'http://192.168.6.144:8000'],
      failover_attempted: true,
      failover_applied: true,
      is_missing_trainer_route: true,
    }));
  });

  it('parses non-json error responses with status and path diagnostics', async () => {
    fetchWithApiFallback.mockResolvedValueOnce({
      response: createTextResponse('upstream timeout while generating draft', { ok: false, status: 500 }),
      baseUrl: 'http://127.0.0.1:8000',
      attemptedBaseUrls: ['http://127.0.0.1:8000'],
      failoverAttempted: false,
      failoverApplied: false,
    });

    await expect(executeTrainerAssistantAction({
      accessToken: 'trainer-token',
      actionType: 'adjust_plan',
      message: 'Adjust the program based on missed workouts.',
    })).rejects.toEqual(expect.objectContaining({
      status: 500,
      request_path: '/api/v1/trainer-assistant/execute',
      api_base_url: 'http://127.0.0.1:8000',
      code: null,
      hint: null,
      details: null,
      message: expect.stringContaining('HTTP 500 for /api/v1/trainer-assistant/execute'),
    }));
  });

  it('uses contextual fallback message for empty error responses', async () => {
    fetchWithApiFallback.mockResolvedValueOnce({
      response: createTextResponse('', { ok: false, status: 502 }),
      baseUrl: 'http://127.0.0.1:8000',
      attemptedBaseUrls: ['http://127.0.0.1:8000'],
      failoverAttempted: false,
      failoverApplied: false,
    });

    await expect(executeTrainerAssistantAction({
      accessToken: 'trainer-token',
      actionType: 'message_client',
      message: 'Draft a follow-up message.',
    })).rejects.toEqual(expect.objectContaining({
      status: 502,
      request_path: '/api/v1/trainer-assistant/execute',
      message: 'HTTP 502 for /api/v1/trainer-assistant/execute',
    }));
  });

  it('preserves backend code and hints from json error payloads', async () => {
    fetchWithApiFallback.mockResolvedValueOnce({
      response: createJsonResponse(
        {
          detail: 'Trainer assistant request could not be completed',
          code: '42703',
          hint: 'Apply migration 20260418b',
          details: 'column trainers.assistant_last_client_id does not exist',
        },
        { ok: false, status: 502 },
      ),
      baseUrl: 'http://127.0.0.1:8000',
      attemptedBaseUrls: ['http://127.0.0.1:8000'],
      failoverAttempted: false,
      failoverApplied: false,
    });

    await expect(executeTrainerAssistantAction({
      accessToken: 'trainer-token',
      actionType: 'message_client',
      message: 'Draft a check-in message.',
    })).rejects.toEqual(expect.objectContaining({
      status: 502,
      request_path: '/api/v1/trainer-assistant/execute',
      code: '42703',
      hint: 'Apply migration 20260418b',
      details: 'column trainers.assistant_last_client_id does not exist',
      message: expect.stringContaining('HTTP 502 for /api/v1/trainer-assistant/execute'),
    }));
  });

  it('attaches connectivity probe diagnostics for execute network failures', async () => {
    fetchWithApiFallback.mockRejectedValueOnce({
      message: 'fetch failed',
      attemptedBaseUrls: ['http://192.168.6.137:8000', 'http://192.168.6.144:8000'],
      failoverAttempted: true,
      failoverApplied: false,
    });
    probeBackendConnectivity.mockResolvedValueOnce({
      endpoint_path: '/healthz',
      timeout_ms: 1800,
      first_reachable_base_url: 'http://192.168.6.144:8000',
      candidate_api_base_urls: ['http://192.168.6.137:8000', 'http://192.168.6.144:8000'],
      attempts: [
        { baseUrl: 'http://192.168.6.137:8000', ok: false, status: null, timedOut: false, error: 'ECONNREFUSED' },
        { baseUrl: 'http://192.168.6.144:8000', ok: true, status: 200, timedOut: false, error: null },
      ],
    });
    selectRecommendedApiBaseUrl.mockReturnValueOnce('http://192.168.6.144:8000');

    await expect(executeTrainerAssistantAction({
      accessToken: 'trainer-token',
      actionType: 'message_client',
      message: 'Draft a check-in note.',
    })).rejects.toEqual(expect.objectContaining({
      stage: 'network',
      request_path: '/api/v1/trainer-assistant/execute',
      recommended_api_base_url: 'http://192.168.6.144:8000',
      connectivity_probe: expect.objectContaining({
        endpoint_path: '/healthz',
        first_reachable_base_url: 'http://192.168.6.144:8000',
      }),
    }));

    expect(probeBackendConnectivity).toHaveBeenCalledTimes(1);
    expect(selectRecommendedApiBaseUrl).toHaveBeenCalledTimes(1);
  });
});

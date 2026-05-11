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
  createTrainerCoachEvent,
  getTrainerCoachWorkspace,
} from '../trainerCoachApi';

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

describe('trainerCoachApi', () => {
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
      attemptedBaseUrls: ['http://127.0.0.1:8000'],
      failoverAttempted: false,
      failoverApplied: false,
    });
  });

  it('adds stale-route retry predicate only for workspace bootstrap reads', async () => {
    await getTrainerCoachWorkspace({
      accessToken: 'trainer-token',
      date: '2026-04-18',
    });
    await createTrainerCoachEvent({
      accessToken: 'trainer-token',
      eventKey: 'event-1',
      eventType: 'system_confirmation',
      message: 'hello',
    });

    expect(fetchWithApiFallback).toHaveBeenNthCalledWith(
      1,
      '/api/v1/trainer-coach/workspace?date=2026-04-18',
      expect.objectContaining({
        method: 'GET',
        shouldRetryOnResponse: expect.any(Function),
      }),
    );
    expect(fetchWithApiFallback).toHaveBeenNthCalledWith(
      2,
      '/api/v1/trainer-coach/events',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(fetchWithApiFallback.mock.calls[1][1].shouldRetryOnResponse).toBeUndefined();
  });

  it('marks stale workspace responses as retryable for host failover', async () => {
    await getTrainerCoachWorkspace({
      accessToken: 'trainer-token',
      date: null,
    });
    const options = fetchWithApiFallback.mock.calls[0][1];
    const shouldRetry = await options.shouldRetryOnResponse(
      createJsonResponse({ detail: 'Not found' }, { ok: false, status: 404 }),
    );

    expect(shouldRetry).toBe(true);
  });

  it('attaches failover diagnostics when workspace still fails after retries', async () => {
    fetchWithApiFallback.mockResolvedValueOnce({
      response: createJsonResponse({ detail: 'Not found' }, { ok: false, status: 404 }),
      baseUrl: 'http://192.168.6.137:8000',
      attemptedBaseUrls: ['http://192.168.6.137:8000', 'http://192.168.6.144:8000'],
      failoverAttempted: true,
      failoverApplied: true,
    });

    await expect(getTrainerCoachWorkspace({
      accessToken: 'trainer-token',
      date: null,
    })).rejects.toEqual(expect.objectContaining({
      status: 404,
      request_path: '/api/v1/trainer-coach/workspace',
      attempted_base_urls: ['http://192.168.6.137:8000', 'http://192.168.6.144:8000'],
      failover_attempted: true,
      failover_applied: true,
      is_missing_trainer_route: true,
    }));
  });

  it('attaches connectivity probe diagnostics for workspace network failures', async () => {
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

    await expect(getTrainerCoachWorkspace({
      accessToken: 'trainer-token',
      date: null,
    })).rejects.toEqual(expect.objectContaining({
      stage: 'network',
      request_path: '/api/v1/trainer-coach/workspace',
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

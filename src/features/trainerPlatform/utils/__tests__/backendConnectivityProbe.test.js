jest.mock('../../../../services/apiBaseUrl', () => ({
  getApiBaseUrls: jest.fn(),
  getApiDebugInfo: jest.fn(),
}));

import {
  getApiBaseUrls,
  getApiDebugInfo,
} from '../../../../services/apiBaseUrl';
import {
  probeBackendConnectivity,
  selectRecommendedApiBaseUrl,
} from '../backendConnectivityProbe';

describe('probeBackendConnectivity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getApiDebugInfo.mockReturnValue({
      configuredApiBaseUrl: 'http://192.168.6.137:8000',
      preferredApiBaseUrl: null,
      resolvedApiBaseUrl: 'http://192.168.6.137:8000',
      candidateApiBaseUrls: ['http://192.168.6.137:8000', 'http://192.168.6.144:8000'],
      suppressLoopbackFallbacks: true,
      isPhysicalDevice: true,
    });
    getApiBaseUrls.mockReturnValue(['http://192.168.6.137:8000', 'http://192.168.6.144:8000']);
  });

  it('reports all attempts when every host is unreachable', async () => {
    const fetchImpl = jest.fn()
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED 192.168.6.137:8000'))
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED 192.168.6.144:8000'));

    const result = await probeBackendConnectivity({
      endpointPath: '/healthz',
      timeoutMs: 50,
      fetchImpl,
    });

    expect(result.first_reachable_base_url).toBeNull();
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0]).toEqual(expect.objectContaining({
      baseUrl: 'http://192.168.6.137:8000',
      ok: false,
      status: null,
      timedOut: false,
      error: expect.stringContaining('ECONNREFUSED'),
    }));
    expect(result.attempts[1]).toEqual(expect.objectContaining({
      baseUrl: 'http://192.168.6.144:8000',
      ok: false,
      status: null,
      timedOut: false,
      error: expect.stringContaining('ECONNREFUSED'),
    }));
  });

  it('records first reachable host when fallback candidate succeeds', async () => {
    const fetchImpl = jest.fn()
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED 192.168.6.137:8000'))
      .mockResolvedValueOnce({ ok: true, status: 200 });

    const result = await probeBackendConnectivity({
      endpointPath: '/healthz',
      timeoutMs: 75,
      fetchImpl,
    });

    expect(result.first_reachable_base_url).toBe('http://192.168.6.144:8000');
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0]).toEqual(expect.objectContaining({
      ok: false,
      status: null,
    }));
    expect(result.attempts[1]).toEqual(expect.objectContaining({
      ok: true,
      status: 200,
    }));
    expect(selectRecommendedApiBaseUrl(result)).toBe('http://192.168.6.144:8000');
  });

  it('marks timeout-style failures deterministically', async () => {
    const timeoutError = new Error('Probe timed out after 30ms');
    timeoutError.name = 'AbortError';
    const fetchImpl = jest.fn().mockRejectedValueOnce(timeoutError);
    getApiBaseUrls.mockReturnValue(['http://192.168.6.137:8000']);
    getApiDebugInfo.mockReturnValue({
      configuredApiBaseUrl: 'http://192.168.6.137:8000',
      preferredApiBaseUrl: null,
      resolvedApiBaseUrl: 'http://192.168.6.137:8000',
      candidateApiBaseUrls: ['http://192.168.6.137:8000'],
      suppressLoopbackFallbacks: true,
      isPhysicalDevice: true,
    });

    const result = await probeBackendConnectivity({
      endpointPath: '/healthz',
      timeoutMs: 30,
      fetchImpl,
    });

    expect(result.first_reachable_base_url).toBeNull();
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]).toEqual(expect.objectContaining({
      ok: false,
      status: null,
      timedOut: true,
      error: expect.stringContaining('timed out'),
    }));
    expect(selectRecommendedApiBaseUrl(result)).toBe('http://192.168.6.137:8000');
  });
});

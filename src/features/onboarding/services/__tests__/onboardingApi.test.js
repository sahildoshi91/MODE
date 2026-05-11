const mockFetchWithApiFallback = jest.fn();
const mockBuildApiNetworkError = jest.fn();
const mockProbeBackendConnectivity = jest.fn();
const mockSelectRecommendedApiBaseUrl = jest.fn();

jest.mock('../../../../services/apiRequest', () => ({
  fetchWithApiFallback: (...args) => mockFetchWithApiFallback(...args),
}));

jest.mock('../../../../services/apiNetworkError', () => ({
  buildApiNetworkError: (...args) => mockBuildApiNetworkError(...args),
}));

jest.mock('../../../../services/backendConnectivityProbe', () => ({
  probeBackendConnectivity: (...args) => mockProbeBackendConnectivity(...args),
  selectRecommendedApiBaseUrl: (...args) => mockSelectRecommendedApiBaseUrl(...args),
}));

import { getOnboardingBootstrap, setOnboardingRole } from '../onboardingApi';

function createHeaders(requestId = 'req-1') {
  return {
    get: jest.fn((name) => (String(name).toLowerCase() === 'x-request-id' ? requestId : null)),
  };
}

describe('onboardingApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('attaches connectivity diagnostics to bootstrap network failures', async () => {
    const fetchError = new Error('fetch failed');
    const networkError = new Error('Unable to reach backend');
    networkError.stage = 'network';
    networkError.resolved_api_base_url = 'http://192.168.6.142:8000';
    networkError.attempted_base_urls = ['http://192.168.6.142:8000'];
    networkError.raw_error_message = 'connect ECONNREFUSED';
    const connectivityProbe = {
      endpoint_path: '/healthz',
      first_reachable_base_url: 'http://192.168.6.144:8000',
      candidate_api_base_urls: ['http://192.168.6.142:8000', 'http://192.168.6.144:8000'],
      attempts: [],
    };

    mockFetchWithApiFallback.mockRejectedValueOnce(fetchError);
    mockBuildApiNetworkError.mockReturnValueOnce(networkError);
    mockProbeBackendConnectivity.mockResolvedValueOnce(connectivityProbe);
    mockSelectRecommendedApiBaseUrl.mockReturnValueOnce('http://192.168.6.144:8000');

    await expect(getOnboardingBootstrap({ accessToken: 'token' })).rejects.toMatchObject({
      stage: 'network',
      request_path: '/api/v1/onboarding/bootstrap',
      attempted_base_urls: ['http://192.168.6.142:8000'],
      resolved_api_base_url: 'http://192.168.6.142:8000',
      raw_error_message: 'connect ECONNREFUSED',
      connectivity_probe: connectivityProbe,
      connectivityProbe,
      recommended_api_base_url: 'http://192.168.6.144:8000',
      recommendedApiBaseUrl: 'http://192.168.6.144:8000',
    });

    expect(mockBuildApiNetworkError).toHaveBeenCalledWith(fetchError, '/api/v1/onboarding/bootstrap');
    expect(mockProbeBackendConnectivity).toHaveBeenCalledWith({
      endpointPath: '/healthz',
      timeoutMs: 1800,
    });
    expect(mockSelectRecommendedApiBaseUrl).toHaveBeenCalledWith(connectivityProbe);
  });

  it('keeps non-network HTTP errors on their existing response path', async () => {
    mockFetchWithApiFallback.mockResolvedValueOnce({
      baseUrl: 'http://127.0.0.1:8000',
      response: {
        ok: false,
        status: 503,
        headers: createHeaders('req-http-1'),
        json: jest.fn().mockResolvedValue({
          detail: 'Backend is unavailable',
          code: 'service_unavailable',
          hint: 'Try again later',
          details: { surface: 'role' },
        }),
      },
    });

    await expect(setOnboardingRole({ accessToken: 'token', role: 'client' })).rejects.toMatchObject({
      message: 'Backend is unavailable',
      status: 503,
      code: 'service_unavailable',
      hint: 'Try again later',
      details: { surface: 'role' },
      request_id: 'req-http-1',
      api_base_url: 'http://127.0.0.1:8000',
    });

    expect(mockProbeBackendConnectivity).not.toHaveBeenCalled();
  });
});

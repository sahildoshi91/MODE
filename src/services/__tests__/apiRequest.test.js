jest.mock('../apiBaseUrl', () => ({
  getApiBaseUrls: jest.fn(),
  rememberApiBaseUrl: jest.fn(),
  resolveApiBaseUrl: jest.fn(),
}));

import {
  getApiBaseUrls,
  rememberApiBaseUrl,
  resolveApiBaseUrl,
} from '../apiBaseUrl';
import { fetchWithApiFallback } from '../apiRequest';

describe('fetchWithApiFallback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
    resolveApiBaseUrl.mockReturnValue('http://api-a:8000');
  });

  it('retries on response predicate and returns failover metadata', async () => {
    getApiBaseUrls.mockReturnValue(['http://api-a:8000', 'http://api-b:8000']);
    global.fetch
      .mockResolvedValueOnce({ status: 404 })
      .mockResolvedValueOnce({ status: 200 });

    const result = await fetchWithApiFallback('/api/v1/trainer-coach/workspace', {
      method: 'GET',
      shouldRetryOnResponse: async (response) => response.status === 404,
    });

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      'http://api-a:8000/api/v1/trainer-coach/workspace',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      'http://api-b:8000/api/v1/trainer-coach/workspace',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(result.baseUrl).toBe('http://api-b:8000');
    expect(result.attemptedBaseUrls).toEqual(['http://api-a:8000', 'http://api-b:8000']);
    expect(result.failoverAttempted).toBe(true);
    expect(result.failoverApplied).toBe(true);
    expect(rememberApiBaseUrl).toHaveBeenCalledWith('http://api-b:8000');
  });

  it('returns first response when retry predicate does not trigger', async () => {
    getApiBaseUrls.mockReturnValue(['http://api-a:8000', 'http://api-b:8000']);
    global.fetch.mockResolvedValueOnce({ status: 404 });

    const result = await fetchWithApiFallback('/api/v1/trainer-coach/workspace', {
      method: 'GET',
      shouldRetryOnResponse: async () => false,
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(result.baseUrl).toBe('http://api-a:8000');
    expect(result.attemptedBaseUrls).toEqual(['http://api-a:8000']);
    expect(result.failoverAttempted).toBe(false);
    expect(result.failoverApplied).toBe(false);
  });

  it('throws with attempted hosts and failover flags when all hosts are unreachable', async () => {
    getApiBaseUrls.mockReturnValue(['http://api-a:8000', 'http://api-b:8000']);
    global.fetch
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

    await expect(fetchWithApiFallback('/api/v1/trainer-coach/workspace', {
      method: 'GET',
    })).rejects.toEqual(expect.objectContaining({
      attemptedBaseUrls: ['http://api-a:8000', 'http://api-b:8000'],
      failoverAttempted: true,
      failoverApplied: false,
    }));
  });

  it('throws a controlled config error without calling fetch when no API candidates are configured', async () => {
    getApiBaseUrls.mockReturnValue([]);
    resolveApiBaseUrl.mockReturnValue(null);

    await expect(
      fetchWithApiFallback('/api/v1/ping', { method: 'GET' }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('No API base URL configured'),
      attemptedBaseUrls: [],
      failoverAttempted: false,
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('prefers timeout as representative cause when later fallback hosts fail fast', async () => {
    getApiBaseUrls.mockReturnValue(['http://api-a:8000', 'http://api-b:8000']);
    global.fetch
      .mockRejectedValueOnce(new Error('Request timed out after 8000ms'))
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

    await expect(fetchWithApiFallback('/api/v1/trainer-assistant/execute', {
      method: 'POST',
    })).rejects.toEqual(expect.objectContaining({
      cause: expect.objectContaining({
        message: 'Request timed out after 8000ms',
      }),
      attemptedErrors: [
        expect.objectContaining({
          base_url: 'http://api-a:8000',
          is_timeout: true,
        }),
        expect.objectContaining({
          base_url: 'http://api-b:8000',
          is_timeout: false,
        }),
      ],
      hasTimeoutAttempt: true,
    }));
  });
});

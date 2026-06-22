jest.mock('../apiBaseUrl', () => ({
  getApiBaseUrls: jest.fn(),
  resolveApiBaseUrl: jest.fn(),
}));

jest.mock('../apiRequest', () => ({
  getApiRequestDebugState: jest.fn(),
}));

import { getApiBaseUrls, resolveApiBaseUrl } from '../apiBaseUrl';
import { getApiRequestDebugState } from '../apiRequest';
import { buildApiNetworkError } from '../apiNetworkError';

describe('apiNetworkError', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resolveApiBaseUrl.mockReturnValue('http://192.168.0.10:8000');
    getApiBaseUrls.mockReturnValue([
      'http://192.168.0.10:8000',
      'http://192.168.0.22:8000',
    ]);
    getApiRequestDebugState.mockReturnValue({
      lastSuccessfulBaseUrl: 'http://192.168.0.22:8000',
    });
  });

  it('includes attempted and resolved API host metadata for UI diagnostics', () => {
    const error = buildApiNetworkError(new Error('fetch failed'), '/api/v1/trainer-assignment/status');

    expect(error.stage).toBe('network');
    expect(error.resolved_api_base_url).toBe('http://192.168.0.10:8000');
    expect(error.attempted_base_urls).toEqual([
      'http://192.168.0.10:8000',
      'http://192.168.0.22:8000',
    ]);
    expect(error.raw_error_message).toBe('fetch failed');
  });

  it('falls back to resolved host when attempted host list is empty', () => {
    getApiBaseUrls.mockReturnValue([]);

    const error = buildApiNetworkError(new Error('network down'), '/api/v1/trainer-assignment/status');

    expect(error.attempted_base_urls).toEqual(['http://192.168.0.10:8000']);
    expect(error.message).toContain('Tried: http://192.168.0.10:8000');
  });

  it('adds deterministic tried-host context for timeout failures', () => {
    const timeoutCause = new Error('Request timed out after 8000ms');
    const wrappedError = {
      cause: timeoutCause,
      attemptedBaseUrls: ['http://192.168.0.10:8000'],
    };

    const error = buildApiNetworkError(wrappedError, '/api/v1/trainer-assignment/status');

    expect(error.message).toContain('timed out');
    expect(error.message).toContain('Tried: http://192.168.0.10:8000');
  });

  it('renders diagnostics safely when resolved base URL is null and no candidates exist', () => {
    resolveApiBaseUrl.mockReturnValue(null);
    getApiBaseUrls.mockReturnValue([]);

    const error = buildApiNetworkError(new Error('config error'), '/api/v1/ping');

    expect(error.resolved_api_base_url).toBeNull();
    expect(error.attempted_base_urls).toEqual([]);
    expect(error.message).not.toMatch(/null/);
    expect(error.stage).toBe('network');
  });

  it('treats timeout attempts as timeout errors even when final cause is not timeout', () => {
    const wrappedError = {
      cause: new Error('connect ECONNREFUSED'),
      attemptedBaseUrls: ['http://192.168.0.10:8000', 'http://192.168.0.22:8000'],
      attemptedErrors: [
        {
          base_url: 'http://192.168.0.10:8000',
          message: 'Request timed out after 8000ms',
          is_timeout: true,
        },
        {
          base_url: 'http://192.168.0.22:8000',
          message: 'connect ECONNREFUSED',
          is_timeout: false,
        },
      ],
    };

    const error = buildApiNetworkError(wrappedError, '/api/v1/trainer-assignment/status');

    expect(error.message).toContain('timed out');
    expect(error.attempt_errors).toEqual(wrappedError.attemptedErrors);
  });
});

jest.mock('../../../../services/apiRequest', () => ({
  fetchWithApiFallback: jest.fn(),
}));

jest.mock('../../../../services/apiNetworkError', () => ({
  buildApiNetworkError: jest.fn((error) => error),
}));

import { fetchWithApiFallback } from '../../../../services/apiRequest';
import {
  createMyMemory,
  deleteMyMemory,
  getMyAlgorithm,
  patchMyWhy,
  updateMyMemory,
} from '../algorithmApi';

function mockJsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    headers: {
      get: jest.fn(() => 'request-1'),
    },
    json: jest.fn(async () => payload),
    text: jest.fn(async () => JSON.stringify(payload)),
  };
}

function mockTextResponse(body, { ok = false, status = 500 } = {}) {
  return {
    ok,
    status,
    headers: {
      get: jest.fn(() => 'request-1'),
    },
    text: jest.fn(async () => body),
  };
}

describe('algorithmApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads the client algorithm payload with auth', async () => {
    fetchWithApiFallback.mockResolvedValueOnce({
      response: mockJsonResponse({ summary_text: 'You are building consistency.' }),
      baseUrl: 'https://api.example',
    });

    const payload = await getMyAlgorithm({ accessToken: 'token-123' });

    expect(payload.summary_text).toBe('You are building consistency.');
    expect(fetchWithApiFallback).toHaveBeenCalledWith(
      '/api/v1/profiles/me/algorithm',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer token-123',
        }),
      }),
    );
  });

  it('persists the first-class Why field', async () => {
    fetchWithApiFallback.mockResolvedValueOnce({
      response: mockJsonResponse({ user_why: 'Keep up with my kid.' }),
      baseUrl: 'https://api.example',
    });

    await patchMyWhy({ accessToken: 'token-123', userWhy: 'Keep up with my kid.' });

    const [path, options] = fetchWithApiFallback.mock.calls[0];
    expect(path).toBe('/api/v1/profiles/me/why');
    expect(options.method).toBe('PATCH');
    expect(JSON.parse(options.body)).toEqual({ user_why: 'Keep up with my kid.' });
  });

  it('creates, updates, and deletes client-owned memories', async () => {
    fetchWithApiFallback
      .mockResolvedValueOnce({ response: mockJsonResponse({ memories: [] }), baseUrl: 'https://api.example' })
      .mockResolvedValueOnce({ response: mockJsonResponse({ memories: [] }), baseUrl: 'https://api.example' })
      .mockResolvedValueOnce({ response: mockJsonResponse({ memories: [] }), baseUrl: 'https://api.example' });

    await createMyMemory({
      accessToken: 'token-123',
      text: 'Prefers morning workouts',
      category: 'schedule',
      aiUsable: false,
      tags: ['morning'],
    });
    await updateMyMemory({
      accessToken: 'token-123',
      memoryId: 'memory 1',
      text: 'Prefers early workouts',
      aiUsable: true,
    });
    await deleteMyMemory({ accessToken: 'token-123', memoryId: 'memory 1' });

    expect(fetchWithApiFallback).toHaveBeenNthCalledWith(
      1,
      '/api/v1/profiles/me/memories',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"ai_usable":false'),
      }),
    );
    expect(fetchWithApiFallback).toHaveBeenNthCalledWith(
      2,
      '/api/v1/profiles/me/memories/memory%201',
      expect.objectContaining({
        method: 'PATCH',
        body: expect.stringContaining('"ai_usable":true'),
      }),
    );
    expect(fetchWithApiFallback).toHaveBeenNthCalledWith(
      3,
      '/api/v1/profiles/me/memories/memory%201',
      expect.objectContaining({
        method: 'DELETE',
      }),
    );
  });

  it('throws parsed API errors with request metadata', async () => {
    fetchWithApiFallback.mockResolvedValueOnce({
      response: mockJsonResponse({ detail: 'Memory not found', code: 'NOT_FOUND' }, { ok: false, status: 404 }),
      baseUrl: 'https://api.example',
    });

    await expect(deleteMyMemory({ accessToken: 'token-123', memoryId: 'missing' }))
      .rejects
      .toMatchObject({
        message: 'Memory not found',
        status: 404,
        code: 'NOT_FOUND',
        request_id: 'request-1',
        api_base_url: 'https://api.example',
      });
  });

  it('surfaces plain text HTTP failures with status instead of a generic message', async () => {
    fetchWithApiFallback.mockResolvedValueOnce({
      response: mockTextResponse('Internal Server Error', { ok: false, status: 500 }),
      baseUrl: 'https://api.example',
    });

    await expect(patchMyWhy({ accessToken: 'token-123', userWhy: 'Keep up with my kid.' }))
      .rejects
      .toMatchObject({
        message: 'Request failed (500): Internal Server Error',
        status: 500,
        request_id: 'request-1',
      });
  });

  it('surfaces object-shaped backend details from storage errors', async () => {
    fetchWithApiFallback.mockResolvedValueOnce({
      response: mockJsonResponse({
        detail: {
          message: 'Your Why storage is not available yet.',
          code: 'PROFILE_STORAGE_MISSING',
          hint: 'Run the migration.',
          details: { migration: '20260504b_your_mode_algorithm_home.sql' },
        },
      }, { ok: false, status: 503 }),
      baseUrl: 'https://api.example',
    });

    await expect(patchMyWhy({ accessToken: 'token-123', userWhy: 'Keep up with my kid.' }))
      .rejects
      .toMatchObject({
        message: 'Your Why storage is not available yet.',
        status: 503,
        code: 'PROFILE_STORAGE_MISSING',
        hint: 'Run the migration.',
        details: { migration: '20260504b_your_mode_algorithm_home.sql' },
      });
  });
});

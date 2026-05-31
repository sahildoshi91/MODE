const mockFetchWithApiFallback = jest.fn();

jest.mock('../../../../services/apiRequest', () => ({
  fetchWithApiFallback: (...args) => mockFetchWithApiFallback(...args),
}));

jest.mock('../../../../services/apiNetworkError', () => ({
  buildApiNetworkError: (error) => error,
}));

import {
  CHAT_SESSION_SCHEMA_MISSING_CODE,
  CHAT_SESSIONS_ROUTE_NOT_FOUND_CODE,
  getTodayChatSession,
  listChatSessions,
} from '../chatSessionService';

function failedResponse(status, body) {
  return {
    ok: false,
    status,
    text: async () => JSON.stringify(body),
    headers: {
      get: () => null,
    },
  };
}

describe('chatSessionService errors', () => {
  let warnSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy?.mockRestore();
  });

  it('uses a 15 second bootstrap timeout for today sessions', async () => {
    mockFetchWithApiFallback.mockResolvedValueOnce({
      baseUrl: 'http://127.0.0.1:8000',
      response: {
        ok: true,
        json: async () => ({
          session: { id: 'session-1' },
          messages: [],
          suggested_actions: [],
          read_only: false,
        }),
      },
    });

    await getTodayChatSession({
      accessToken: 'token',
      role: 'client',
      sessionType: 'client_chat',
      sessionDate: '2026-05-04',
    });

    expect(mockFetchWithApiFallback).toHaveBeenCalledWith('/api/v1/chat/sessions/today', expect.objectContaining({
      timeoutMs: 15000,
    }));
  });

  it('maps structured missing-schema responses to a migration-specific error', async () => {
    mockFetchWithApiFallback.mockResolvedValueOnce({
      baseUrl: 'http://127.0.0.1:8000',
      response: failedResponse(503, {
        detail: {
          code: CHAT_SESSION_SCHEMA_MISSING_CODE,
          message: 'Chat session storage is not migrated on this backend yet.',
          hint: 'Run the migration.',
        },
      }),
    });

    await expect(getTodayChatSession({
      accessToken: 'token',
      role: 'client',
      sessionType: 'client_chat',
      sessionDate: '2026-05-04',
    })).rejects.toMatchObject({
      status: 503,
      code: CHAT_SESSION_SCHEMA_MISSING_CODE,
      message: 'Chat session storage is not migrated on this backend yet.',
      hint: 'Run the migration.',
      request_path: '/api/v1/chat/sessions/today',
      api_base_url: 'http://127.0.0.1:8000',
    });
  });

  it('maps history route 404s to route-not-found diagnostics', async () => {
    mockFetchWithApiFallback.mockResolvedValueOnce({
      baseUrl: 'http://127.0.0.1:8000',
      response: failedResponse(404, { detail: 'Not Found' }),
    });

    await expect(listChatSessions({
      accessToken: 'token',
      role: 'client',
      sessionType: 'client_chat',
    })).rejects.toMatchObject({
      status: 404,
      code: CHAT_SESSIONS_ROUTE_NOT_FOUND_CODE,
      message: 'Coach session is not available on this backend yet.',
      request_path: '/api/v1/chat/sessions?role=client&session_type=client_chat&limit=60',
    });
  });
});

const mockFetchWithApiFallback = jest.fn();
const mockConsumeSseStream = jest.fn();

jest.mock('../../../../services/apiRequest', () => ({
  fetchWithApiFallback: (...args) => mockFetchWithApiFallback(...args),
}));

jest.mock('../../../../services/apiNetworkError', () => ({
  buildApiNetworkError: (error) => error,
}));

jest.mock('../../../messaging', () => ({
  consumeSseStream: (...args) => mockConsumeSseStream(...args),
}));

import {
  sendChatSessionMessage,
  streamChatSessionMessage,
} from '../chatMessageService';

function okJsonResponse(payload = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    headers: {
      get: () => null,
    },
  };
}

describe('chatMessageService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('includes session_date in non-stream message sends', async () => {
    mockFetchWithApiFallback.mockResolvedValueOnce({
      baseUrl: 'http://127.0.0.1:8000',
      response: okJsonResponse({ ok: true }),
    });

    await sendChatSessionMessage({
      accessToken: 'token',
      sessionId: 'session-1',
      message: 'Reach step goal',
      sessionDate: '2026-05-03',
    });

    const [, options] = mockFetchWithApiFallback.mock.calls[0];
    expect(JSON.parse(options.body)).toMatchObject({
      message: 'Reach step goal',
      client_context: {},
      session_date: '2026-05-03',
    });
  });

  it('includes session_date in stream message sends', async () => {
    mockFetchWithApiFallback.mockResolvedValueOnce({
      baseUrl: 'http://127.0.0.1:8000',
      response: okJsonResponse(),
    });
    mockConsumeSseStream.mockResolvedValueOnce(undefined);

    await streamChatSessionMessage({
      accessToken: 'token',
      sessionId: 'session-1',
      message: 'Reach step goal',
      sessionDate: '2026-05-03',
      onEvent: jest.fn(),
    });

    const [, options] = mockFetchWithApiFallback.mock.calls[0];
    expect(JSON.parse(options.body)).toMatchObject({
      message: 'Reach step goal',
      client_context: {},
      session_date: '2026-05-03',
    });
  });
});

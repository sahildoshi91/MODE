jest.mock('../../../../services/apiRequest', () => ({
  fetchWithApiFallback: jest.fn(),
}));

jest.mock('../../../../services/apiNetworkError', () => ({
  buildApiNetworkError: jest.fn((error) => error),
}));

import { fetchWithApiFallback } from '../../../../services/apiRequest';
import {
  approveTrainerReviewOutput,
  getTrainerReviewOutputs,
} from '../trainerReviewApi';

function createJsonResponse(payload = {}, { ok = true, status = 200, requestId = null } = {}) {
  return {
    ok,
    status,
    json: jest.fn().mockResolvedValue(payload),
    headers: {
      get: jest.fn((name) => (name === 'x-request-id' ? requestId : null)),
    },
  };
}

describe('trainerReviewApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('builds the trainer review outputs query with the expected filters', async () => {
    fetchWithApiFallback.mockResolvedValue({
      response: createJsonResponse({ items: [], count: 0 }),
      baseUrl: 'http://127.0.0.1:8000',
    });

    await getTrainerReviewOutputs({
      accessToken: 'trainer-token',
      status: 'approved',
      sourceType: 'chat',
      limit: 25,
      offset: 10,
    });

    expect(fetchWithApiFallback).toHaveBeenCalledWith(
      '/api/v1/trainer-review/outputs?status=approved&source_type=chat&limit=25&offset=10',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer trainer-token',
        }),
      }),
    );
  });

  it('posts the approval payload using API contract field names', async () => {
    fetchWithApiFallback.mockResolvedValue({
      response: createJsonResponse({ ok: true }),
      baseUrl: 'http://127.0.0.1:8000',
    });

    await approveTrainerReviewOutput({
      accessToken: 'trainer-token',
      outputId: 'output-42',
      editedOutputText: 'Approved answer',
      editedOutputJson: { tone: 'direct' },
      responseTags: ['approved', 'trainer-reviewed'],
      autoApplyDeltas: false,
    });

    expect(fetchWithApiFallback).toHaveBeenCalledWith(
      '/api/v1/trainer-review/outputs/output-42/approve',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer trainer-token',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          edited_output_text: 'Approved answer',
          edited_output_json: { tone: 'direct' },
          response_tags: ['approved', 'trainer-reviewed'],
          auto_apply_deltas: false,
        }),
      }),
    );
  });
});

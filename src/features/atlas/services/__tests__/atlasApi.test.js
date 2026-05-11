jest.mock('../../../../services/apiRequest', () => ({
  fetchWithApiFallback: jest.fn(),
}));

jest.mock('../../../../services/apiNetworkError', () => ({
  buildApiNetworkError: jest.fn((error) => error),
}));

import { fetchWithApiFallback } from '../../../../services/apiRequest';
import {
  approveAtlasAdminReviewQueueItem,
  approveTrainerAiReviewQueueItem,
  getAtlasAdminMe,
  getTrainerAiReviewQueue,
  updateTrainerAiReviewQueueItem,
} from '../atlasApi';

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

describe('atlasApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchWithApiFallback.mockResolvedValue({
      response: createJsonResponse({ ok: true }),
      baseUrl: 'http://127.0.0.1:8000',
    });
  });

  it('loads trainer AI learning review queue with scoped path', async () => {
    await getTrainerAiReviewQueue({ accessToken: 'token-1', status: 'pending', limit: 25 });

    expect(fetchWithApiFallback).toHaveBeenCalledWith(
      '/api/v1/atlas/trainer-ai/review-queue?status=pending&limit=25',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer token-1' }),
      }),
    );
  });

  it('approves trainer AI review queue item', async () => {
    await approveTrainerAiReviewQueueItem({ accessToken: 'token-1', queueId: 'queue-1' });

    expect(fetchWithApiFallback).toHaveBeenCalledWith(
      '/api/v1/atlas/trainer-ai/review-queue/queue-1/approve',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('updates trainer AI review queue item with API field names', async () => {
    await updateTrainerAiReviewQueueItem({
      accessToken: 'token-1',
      queueId: 'queue-1',
      proposedRule: 'This trainer prefers concise check-ins.',
      reviewerNotes: 'Looks good',
    });

    expect(fetchWithApiFallback).toHaveBeenCalledWith(
      '/api/v1/atlas/trainer-ai/review-queue/queue-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          proposed_rule: 'This trainer prefers concise check-ins.',
          reviewer_notes: 'Looks good',
        }),
      }),
    );
  });

  it('loads Atlas admin allowlist status', async () => {
    await getAtlasAdminMe({ accessToken: 'token-1' });

    expect(fetchWithApiFallback).toHaveBeenCalledWith(
      '/api/v1/atlas/admin/me',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('approves Atlas admin review queue item with reviewer notes', async () => {
    await approveAtlasAdminReviewQueueItem({
      accessToken: 'token-1',
      queueId: 'atlas-queue-1',
      reviewerNotes: 'Approved after privacy review',
    });

    expect(fetchWithApiFallback).toHaveBeenCalledWith(
      '/api/v1/atlas/admin/review-queue/atlas-queue-1/approve',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ reviewer_notes: 'Approved after privacy review' }),
      }),
    );
  });
});

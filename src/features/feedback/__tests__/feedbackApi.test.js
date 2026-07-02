jest.mock('../../../services/apiRequest', () => ({
  fetchWithApiFallback: jest.fn(),
}));

import { fetchWithApiFallback } from '../../../services/apiRequest';
import {
  getAdminScreenshotUrl,
  listAdminReports,
  submitFeedbackReport,
  updateAdminReport,
} from '../feedbackApi';

function makeOkResponse(payload) {
  return {
    response: {
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(JSON.stringify(payload)),
    },
  };
}

function makeErrorResponse(status, detail) {
  return {
    response: {
      ok: false,
      status,
      text: jest.fn().mockResolvedValue(JSON.stringify({ detail })),
    },
  };
}

describe('feedbackApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('submitFeedbackReport', () => {
    it('calls fetchWithApiFallback with correct path and body', async () => {
      fetchWithApiFallback.mockResolvedValue(
        makeOkResponse({ id: 'r1', report_type: 'bug', summary: 'Test', status: 'open', created_at: '2026-07-02T00:00:00Z' }),
      );

      const body = { report_type: 'bug', summary: 'Test crash' };
      await submitFeedbackReport('token-abc', body);

      expect(fetchWithApiFallback).toHaveBeenCalledWith(
        '/api/v1/feedback/reports',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer token-abc' }),
          body: JSON.stringify(body),
        }),
      );
    });

    it('throws on non-ok response', async () => {
      fetchWithApiFallback.mockResolvedValue(makeErrorResponse(422, 'Invalid type'));
      await expect(submitFeedbackReport('token', { report_type: 'bug', summary: 'x' })).rejects.toThrow('Invalid type');
    });
  });

  describe('listAdminReports', () => {
    it('calls admin reports path', async () => {
      fetchWithApiFallback.mockResolvedValue(makeOkResponse([]));
      await listAdminReports('token', {});
      expect(fetchWithApiFallback).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/feedback/admin/reports'),
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('appends before query param when provided', async () => {
      fetchWithApiFallback.mockResolvedValue(makeOkResponse([]));
      await listAdminReports('token', { before: '2026-07-01T00:00:00Z' });
      expect(fetchWithApiFallback).toHaveBeenCalledWith(
        expect.stringContaining('before=2026-07-01T00%3A00%3A00Z'),
        expect.any(Object),
      );
    });

    it('appends status param when provided', async () => {
      fetchWithApiFallback.mockResolvedValue(makeOkResponse([]));
      await listAdminReports('token', { status: 'open' });
      expect(fetchWithApiFallback).toHaveBeenCalledWith(
        expect.stringContaining('status=open'),
        expect.any(Object),
      );
    });
  });

  describe('updateAdminReport', () => {
    it('calls patch endpoint with report id and body', async () => {
      fetchWithApiFallback.mockResolvedValue(
        makeOkResponse({ id: 'r1', status: 'resolved', report_type: 'bug', summary: 'x', created_at: 'x', updated_at: 'x', user_id: 'u1', screen_context: {}, debug_context: {} }),
      );
      await updateAdminReport('token', 'r1', { status: 'resolved' });
      expect(fetchWithApiFallback).toHaveBeenCalledWith(
        '/api/v1/feedback/admin/reports/r1',
        expect.objectContaining({ method: 'PATCH' }),
      );
    });
  });

  describe('getAdminScreenshotUrl', () => {
    it('returns signed_url from response', async () => {
      fetchWithApiFallback.mockResolvedValue(
        makeOkResponse({ signed_url: 'https://storage.example/shot.png', expires_in: 300 }),
      );
      const url = await getAdminScreenshotUrl('token', 'r1');
      expect(url).toBe('https://storage.example/shot.png');
    });
  });
});

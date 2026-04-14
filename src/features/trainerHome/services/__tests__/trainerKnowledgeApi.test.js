jest.mock('../../../../services/apiRequest', () => ({
  fetchWithApiFallback: jest.fn(),
}));

jest.mock('../../../../services/apiNetworkError', () => ({
  buildApiNetworkError: jest.fn((error) => error),
}));

import { fetchWithApiFallback } from '../../../../services/apiRequest';
import {
  deleteTrainerKnowledgeDocument,
  saveTrainerKnowledgeDocumentWithFallback,
  updateTrainerKnowledgeDocument,
} from '../trainerKnowledgeApi';

function createJsonResponse(
  payload = {},
  { ok = true, status = 200, requestId = null } = {},
) {
  return {
    ok,
    status,
    json: jest.fn().mockResolvedValue(payload),
    headers: {
      get: jest.fn((name) => (name === 'x-request-id' ? requestId : null)),
    },
  };
}

describe('trainerKnowledgeApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses ingest when ingest succeeds', async () => {
    fetchWithApiFallback.mockResolvedValue({
      response: createJsonResponse({
        document: { id: 'doc-1', title: 'Methodology' },
        extracted_rules: [],
        extraction: { rules_created: 2, fallback_reason: null },
      }),
      baseUrl: 'http://127.0.0.1:8000',
    });

    const result = await saveTrainerKnowledgeDocumentWithFallback({
      accessToken: 'trainer-token',
      title: 'Methodology',
      rawText: 'Progress load when form quality is stable.',
      metadata: { source: 'agent_lab' },
    });

    expect(fetchWithApiFallback).toHaveBeenCalledTimes(1);
    expect(fetchWithApiFallback).toHaveBeenCalledWith(
      '/api/v1/trainer-knowledge/ingest',
      expect.objectContaining({
        method: 'POST',
        timeoutMs: 20000,
        headers: expect.objectContaining({
          Authorization: 'Bearer trainer-token',
        }),
      }),
    );
    expect(result.fallback_used).toBe(false);
    expect(result.extraction.rules_created).toBe(2);
  });

  it('falls back to raw create when ingest fails', async () => {
    fetchWithApiFallback
      .mockResolvedValueOnce({
        response: createJsonResponse(
          { detail: 'ingest unavailable' },
          { ok: false, status: 500 },
        ),
        baseUrl: 'http://127.0.0.1:8000',
      })
      .mockResolvedValueOnce({
        response: createJsonResponse({
          id: 'doc-2',
          trainer_id: 'trainer-1',
          title: 'Methodology',
          raw_text: 'Fallback save',
        }),
        baseUrl: 'http://127.0.0.1:8000',
      });

    const result = await saveTrainerKnowledgeDocumentWithFallback({
      accessToken: 'trainer-token',
      title: 'Methodology',
      rawText: 'Fallback save',
      metadata: { source: 'agent_lab' },
    });

    expect(fetchWithApiFallback).toHaveBeenCalledTimes(2);
    expect(fetchWithApiFallback).toHaveBeenNthCalledWith(
      1,
      '/api/v1/trainer-knowledge/ingest',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchWithApiFallback).toHaveBeenNthCalledWith(
      2,
      '/api/v1/trainer-knowledge',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result.fallback_used).toBe(true);
    expect(result.extraction.fallback_reason).toBe('ingest_request_failed');
    expect(result.document.id).toBe('doc-2');
  });

  it('patches a saved document using the update endpoint contract', async () => {
    fetchWithApiFallback.mockResolvedValue({
      response: createJsonResponse({
        document: {
          id: 'doc-1',
          title: 'Updated',
        },
        extracted_rules: [],
        extraction: { rules_created: 1 },
      }),
      baseUrl: 'http://127.0.0.1:8000',
    });

    await updateTrainerKnowledgeDocument({
      accessToken: 'trainer-token',
      documentId: 'doc-1',
      title: 'Updated',
      rawText: 'Updated raw text',
      documentType: 'text',
      fileUrl: null,
      metadata: { source: 'agent_lab' },
    });

    expect(fetchWithApiFallback).toHaveBeenCalledWith(
      '/api/v1/trainer-knowledge/doc-1',
      expect.objectContaining({
        method: 'PATCH',
        timeoutMs: 20000,
        headers: expect.objectContaining({
          Authorization: 'Bearer trainer-token',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          title: 'Updated',
          raw_text: 'Updated raw text',
          document_type: 'text',
          file_url: null,
          metadata: { source: 'agent_lab' },
        }),
      }),
    );
  });

  it('deletes a saved document using the delete endpoint contract', async () => {
    fetchWithApiFallback.mockResolvedValue({
      response: createJsonResponse({
        id: 'doc-1',
        title: 'Updated',
      }),
      baseUrl: 'http://127.0.0.1:8000',
    });

    await deleteTrainerKnowledgeDocument({
      accessToken: 'trainer-token',
      documentId: 'doc-1',
    });

    expect(fetchWithApiFallback).toHaveBeenCalledWith(
      '/api/v1/trainer-knowledge/doc-1',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({
          Authorization: 'Bearer trainer-token',
        }),
      }),
    );
  });
});

jest.mock('../../../../services/apiRequest', () => ({
  fetchWithApiFallback: jest.fn(),
}));

jest.mock('../../../../services/apiNetworkError', () => ({
  buildApiNetworkError: jest.fn((error) => error),
}));

import { fetchWithApiFallback } from '../../../../services/apiRequest';
import {
  archiveTrainerKnowledgeEntry,
  createTrainerKnowledgeEntry,
  deleteTrainerKnowledgeDocument,
  listTrainerKnowledgeEntries,
  saveTrainerKnowledgeDocumentWithFallback,
  updateTrainerKnowledgeEntry,
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

  it('lists knowledge entries with query filters', async () => {
    fetchWithApiFallback.mockResolvedValue({
      response: createJsonResponse([]),
      baseUrl: 'http://127.0.0.1:8000',
    });

    await listTrainerKnowledgeEntries({
      accessToken: 'trainer-token',
      includeArchived: true,
      scope: 'client_specific',
      aiEnabled: true,
      clientId: 'client-1',
      query: 'sleep',
      limit: 20,
      offset: 10,
    });

    expect(fetchWithApiFallback).toHaveBeenCalledWith(
      '/api/v1/trainer-knowledge/entries?include_archived=true&scope=client&ai_usable=true&ai_enabled=true&client_id=client-1&query=sleep&limit=20&offset=10',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer trainer-token',
        }),
      }),
    );
  });

  it('creates, updates, and archives knowledge entries with new endpoint contracts', async () => {
    fetchWithApiFallback
      .mockResolvedValueOnce({
        response: createJsonResponse({ entry: { id: 'entry-1' } }),
        baseUrl: 'http://127.0.0.1:8000',
      })
      .mockResolvedValueOnce({
        response: createJsonResponse({ entry: { id: 'entry-1', title: 'Updated' } }),
        baseUrl: 'http://127.0.0.1:8000',
      })
      .mockResolvedValueOnce({
        response: createJsonResponse({ entry: { id: 'entry-1', status: 'archived' } }),
        baseUrl: 'http://127.0.0.1:8000',
      });

    await createTrainerKnowledgeEntry({
      accessToken: 'trainer-token',
      title: 'Initial',
      rawContent: 'Reduce intensity when sleep is poor',
      knowledgeType: 'coaching_rule',
      scope: 'global',
      tags: ['sleep', 'recovery'],
      aiEnabled: true,
    });
    await updateTrainerKnowledgeEntry({
      accessToken: 'trainer-token',
      entryId: 'entry-1',
      title: 'Updated',
      rawContent: 'Updated',
      status: 'active',
    });
    await archiveTrainerKnowledgeEntry({
      accessToken: 'trainer-token',
      entryId: 'entry-1',
    });

    expect(fetchWithApiFallback).toHaveBeenNthCalledWith(
      1,
      '/api/v1/trainer-knowledge/entries',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchWithApiFallback).toHaveBeenNthCalledWith(
      2,
      '/api/v1/trainer-knowledge/entries/entry-1',
      expect.objectContaining({ method: 'PATCH' }),
    );
    expect(fetchWithApiFallback).toHaveBeenNthCalledWith(
      3,
      '/api/v1/trainer-knowledge/entries/entry-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('falls back to legacy document save when entries endpoint returns method not allowed', async () => {
    fetchWithApiFallback
      .mockResolvedValueOnce({
        response: createJsonResponse(
          { detail: 'Method Not Allowed' },
          { ok: false, status: 405 },
        ),
        baseUrl: 'http://127.0.0.1:8000',
      })
      .mockResolvedValueOnce({
        response: createJsonResponse({
          document: {
            id: 'doc-legacy-1',
            trainer_id: 'trainer-1',
            title: 'Legacy saved note',
            raw_text: 'Fallback body',
            metadata: {
              legacy_knowledge_entry: {
                scope: 'global',
                knowledge_type: 'coaching_rule',
                ai_enabled: true,
                status: 'active',
              },
            },
          },
          extracted_rules: [],
          extraction: { rules_created: 0 },
        }),
        baseUrl: 'http://127.0.0.1:8000',
      });

    const result = await createTrainerKnowledgeEntry({
      accessToken: 'trainer-token',
      title: 'Legacy saved note',
      rawContent: 'Fallback body',
      knowledgeType: 'coaching_rule',
      scope: 'global',
      tags: ['sleep'],
      aiEnabled: true,
    });

    expect(fetchWithApiFallback).toHaveBeenNthCalledWith(
      1,
      '/api/v1/trainer-knowledge/entries',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchWithApiFallback).toHaveBeenNthCalledWith(
      2,
      '/api/v1/trainer-knowledge/ingest',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result?.entry?.id).toBe('doc-legacy-1');
    expect(result?.entry?.scope).toBe('global');
    expect(result?.entry?.knowledge_type).toBe('rule');
  });

  it('normalizes client scope alias to canonical client for entry create and update payloads', async () => {
    fetchWithApiFallback
      .mockResolvedValueOnce({
        response: createJsonResponse({ entry: { id: 'entry-5' } }),
        baseUrl: 'http://127.0.0.1:8000',
      })
      .mockResolvedValueOnce({
        response: createJsonResponse({ entry: { id: 'entry-5' } }),
        baseUrl: 'http://127.0.0.1:8000',
      });

    await createTrainerKnowledgeEntry({
      accessToken: 'trainer-token',
      title: 'Client note',
      rawContent: 'Client-specific content',
      scope: 'client',
      clientId: 'client-1',
    });

    await updateTrainerKnowledgeEntry({
      accessToken: 'trainer-token',
      entryId: 'entry-5',
      scope: 'client',
    });

    const createCallBody = JSON.parse(fetchWithApiFallback.mock.calls[0][1].body);
    const updateCallBody = JSON.parse(fetchWithApiFallback.mock.calls[1][1].body);
    expect(createCallBody.scope).toBe('client');
    expect(updateCallBody.scope).toBe('client');
  });
});

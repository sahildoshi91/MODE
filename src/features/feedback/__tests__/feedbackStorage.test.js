jest.mock('../../../services/apiRequest', () => ({
  fetchWithApiFallback: jest.fn(),
}));

global.fetch = jest.fn();

import { fetchWithApiFallback } from '../../../services/apiRequest';
import { uploadScreenshot } from '../feedbackStorage';

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

const UPLOAD_URL_RESPONSE = {
  signed_upload_url: 'https://storage.example/upload/key',
  upload_token: 'tok-abc',
  object_path: 'feedback/user-1/abc.png',
  bucket: 'private-user-files',
};

describe('feedbackStorage.uploadScreenshot', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: blob fetch resolves
    fetch.mockResolvedValue({ ok: true, blob: jest.fn().mockResolvedValue(new Blob()) });
  });

  it('calls upload-url, PUT, then upload-complete on success', async () => {
    fetchWithApiFallback
      .mockResolvedValueOnce(makeOkResponse(UPLOAD_URL_RESPONSE)) // upload-url
      .mockResolvedValueOnce(makeOkResponse({ status: 'verified', verified: true })); // upload-complete

    const result = await uploadScreenshot('token', 'file:///tmp/shot.png');

    expect(result).toEqual({
      bucket: UPLOAD_URL_RESPONSE.bucket,
      object_path: UPLOAD_URL_RESPONSE.object_path,
    });

    // upload-url call
    expect(fetchWithApiFallback).toHaveBeenNthCalledWith(
      1,
      '/api/v1/storage/private/upload-url',
      expect.objectContaining({ method: 'POST' }),
    );
    // upload-complete call
    expect(fetchWithApiFallback).toHaveBeenNthCalledWith(
      2,
      '/api/v1/storage/private/upload-complete',
      expect.objectContaining({ method: 'POST' }),
    );
    // direct PUT to signed URL
    expect(fetch).toHaveBeenCalledWith(
      UPLOAD_URL_RESPONSE.signed_upload_url,
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('returns warning without calling upload-complete when upload-url fails', async () => {
    fetchWithApiFallback.mockResolvedValueOnce(makeErrorResponse(500, 'Internal error'));

    const result = await uploadScreenshot('token', 'file:///tmp/shot.png');

    expect(result.warning).toBeDefined();
    expect(result.error).toBeDefined();
    // upload-complete must NOT have been called
    expect(fetchWithApiFallback).toHaveBeenCalledTimes(1);
  });

  it('returns warning when PUT to storage fails', async () => {
    fetchWithApiFallback.mockResolvedValueOnce(makeOkResponse(UPLOAD_URL_RESPONSE));
    fetch.mockResolvedValueOnce({ ok: false, blob: jest.fn().mockResolvedValue(new Blob()) });
    // First fetch call is for blob (uriToBlob), second for PUT
    fetch
      .mockResolvedValueOnce({ ok: true, blob: jest.fn().mockResolvedValue(new Blob()) }) // blob fetch
      .mockResolvedValueOnce({ ok: false }); // PUT

    const result = await uploadScreenshot('token', 'file:///tmp/shot.png');

    expect(result.warning).toBeDefined();
  });

  it('returns warning on thrown error without crashing', async () => {
    fetchWithApiFallback.mockRejectedValueOnce(new Error('Network fail'));
    const result = await uploadScreenshot('token', 'file:///tmp/shot.png');
    expect(result.warning).toBeDefined();
    expect(result.error).toContain('Network fail');
  });
});

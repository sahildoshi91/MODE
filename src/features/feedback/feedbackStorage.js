import { fetchWithApiFallback } from '../../services/apiRequest';

async function parseJsonResponse(response) {
  const text = await response.text().catch(() => '');
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/**
 * Upload a screenshot for a feedback report.
 * Returns { bucket, object_path } on success.
 * Returns { error, warning } on any failure — never throws.
 * Callers must continue with text-only submission on warning.
 */
export async function uploadScreenshot(accessToken, imageUri) {
  try {
    // Step 1: request signed upload URL
    const urlRes = await fetchWithApiFallback('/api/v1/storage/private/upload-url', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        scope: 'feedback_screenshot',
        filename: 'screenshot.png',
        mime_type: 'image/png',
        size_bytes: 1024 * 1024, // estimated; actual size not required at URL issue time
      }),
    });
    const urlPayload = await parseJsonResponse(urlRes.response);
    if (!urlRes.response.ok) {
      return {
        error: urlPayload?.detail || 'Failed to get upload URL',
        warning: 'Screenshot could not be attached',
      };
    }
    const { signed_upload_url, upload_token, object_path, bucket } = urlPayload;

    // Step 2: upload the image blob directly to the signed URL
    const imageBlob = await uriToBlob(imageUri);
    const uploadResp = await fetch(signed_upload_url, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: imageBlob,
    });
    if (!uploadResp.ok) {
      return {
        error: `Upload failed with status ${uploadResp.status}`,
        warning: 'Screenshot could not be attached',
      };
    }

    // Step 3: register upload completion / create ownership record
    const completeRes = await fetchWithApiFallback('/api/v1/storage/private/upload-complete', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ upload_token, object_path, bucket }),
    });
    if (!completeRes.response.ok) {
      return {
        error: 'Upload-complete verification failed',
        warning: 'Screenshot could not be attached',
      };
    }

    return { bucket, object_path };
  } catch (err) {
    return {
      error: String(err?.message || err),
      warning: 'Screenshot could not be attached',
    };
  }
}

async function uriToBlob(uri) {
  const resp = await fetch(uri);
  return resp.blob();
}

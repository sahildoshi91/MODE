import { fetchWithApiFallback } from '../../../services/apiRequest';
import { buildApiNetworkError } from '../../../services/apiNetworkError';

function buildNetworkError(error, path) {
  return buildApiNetworkError(error, path);
}

async function parseError(response) {
  try {
    const payload = await response.json();
    return {
      message: payload?.detail || payload?.message || 'Request failed',
      code: payload?.code || null,
      hint: payload?.hint || null,
      details: payload?.details || null,
    };
  } catch (_error) {
    return {
      message: 'Request failed',
      code: null,
      hint: null,
      details: null,
    };
  }
}

async function requestTrainerPrograms(path, {
  accessToken,
  method = 'GET',
  body,
} = {}) {
  let response;
  let baseUrl;

  try {
    ({ response, baseUrl } = await fetchWithApiFallback(path, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      timeoutMs: 12000,
    }));
  } catch (error) {
    const networkError = buildNetworkError(error, path);
    networkError.request_path = path;
    throw networkError;
  }

  if (!response.ok) {
    const parsed = await parseError(response);
    const error = new Error(parsed.message || 'Unable to mutate trainer program template.');
    error.status = response.status;
    error.code = parsed.code;
    error.hint = parsed.hint;
    error.details = parsed.details;
    error.request_id = response.headers.get('x-request-id');
    error.api_base_url = baseUrl;
    error.request_path = path;
    throw error;
  }

  return response.json();
}

export async function listTrainerProgramTemplates({
  accessToken,
  includeArchived = false,
  limit = 120,
}) {
  const query = [];
  if (includeArchived) {
    query.push('include_archived=true');
  }
  if (typeof limit === 'number') {
    query.push(`limit=${encodeURIComponent(String(limit))}`);
  }
  const suffix = query.length > 0 ? `?${query.join('&')}` : '';
  return requestTrainerPrograms(`/api/v1/trainer-programs/templates${suffix}`, { accessToken });
}

export async function createTrainerProgramTemplate({
  accessToken,
  name,
  goalType = null,
  experienceLevel = null,
  equipmentAccess = null,
  frequency = null,
  templateJson = {},
  metadata = {},
}) {
  return requestTrainerPrograms('/api/v1/trainer-programs/templates', {
    accessToken,
    method: 'POST',
    body: {
      name,
      goal_type: goalType,
      experience_level: experienceLevel,
      equipment_access: equipmentAccess,
      frequency,
      template_json: templateJson || {},
      metadata: metadata || {},
    },
  });
}

export async function patchTrainerProgramTemplate({
  accessToken,
  templateId,
  name = undefined,
  goalType = undefined,
  experienceLevel = undefined,
  equipmentAccess = undefined,
  frequency = undefined,
  templateJson = undefined,
  metadata = undefined,
}) {
  const body = {};
  if (typeof name !== 'undefined') {
    body.name = name;
  }
  if (typeof goalType !== 'undefined') {
    body.goal_type = goalType;
  }
  if (typeof experienceLevel !== 'undefined') {
    body.experience_level = experienceLevel;
  }
  if (typeof equipmentAccess !== 'undefined') {
    body.equipment_access = equipmentAccess;
  }
  if (typeof frequency !== 'undefined') {
    body.frequency = frequency;
  }
  if (typeof templateJson !== 'undefined') {
    body.template_json = templateJson;
  }
  if (typeof metadata !== 'undefined') {
    body.metadata = metadata;
  }

  return requestTrainerPrograms(`/api/v1/trainer-programs/templates/${encodeURIComponent(templateId)}`, {
    accessToken,
    method: 'PATCH',
    body,
  });
}

export async function archiveTrainerProgramTemplate({
  accessToken,
  templateId,
}) {
  return requestTrainerPrograms(`/api/v1/trainer-programs/templates/${encodeURIComponent(templateId)}/archive`, {
    accessToken,
    method: 'POST',
    body: {},
  });
}

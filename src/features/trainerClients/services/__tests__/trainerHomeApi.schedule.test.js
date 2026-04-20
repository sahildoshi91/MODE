jest.mock('../../../../services/apiRequest', () => ({
  fetchWithApiFallback: jest.fn(),
}));

jest.mock('../../../../services/apiNetworkError', () => ({
  buildApiNetworkError: jest.fn((error) => error),
}));

import { fetchWithApiFallback } from '../../../../services/apiRequest';
import {
  createTrainerClientScheduleException,
  deleteTrainerClientScheduleException,
  getMyTrainerSchedule,
  getTrainerClientSchedulePreferences,
  getTrainerSettingsMe,
  patchTrainerClientSchedulePreferences,
  patchTrainerSettingsMe,
} from '../trainerHomeApi';

function createJsonResponse(payload = {}, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: jest.fn().mockResolvedValue(payload),
    headers: {
      get: jest.fn(() => null),
    },
  };
}

describe('trainerHomeApi schedule endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchWithApiFallback.mockResolvedValue({
      response: createJsonResponse({ ok: true }),
      baseUrl: 'http://127.0.0.1:8000',
    });
  });

  it('calls trainer settings get/patch endpoints', async () => {
    await getTrainerSettingsMe({ accessToken: 'trainer-token' });
    await patchTrainerSettingsMe({
      accessToken: 'trainer-token',
      defaultMeetingLocation: 'Main Gym',
      autoFillMeetingLocation: false,
      assistantDisplayName: 'Atlas',
    });

    expect(fetchWithApiFallback).toHaveBeenNthCalledWith(
      1,
      '/api/v1/trainer-settings/me',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer trainer-token',
        }),
      }),
    );
    expect(fetchWithApiFallback).toHaveBeenNthCalledWith(
      2,
      '/api/v1/trainer-settings/me',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          default_meeting_location: 'Main Gym',
          auto_fill_meeting_location: false,
          assistant_display_name: 'Atlas',
        }),
      }),
    );
  });

  it('calls schedule preferences and exception endpoints', async () => {
    await getTrainerClientSchedulePreferences({
      accessToken: 'trainer-token',
      clientId: 'client-1',
      date: '2026-04-20',
    });
    await patchTrainerClientSchedulePreferences({
      accessToken: 'trainer-token',
      clientId: 'client-1',
      recurringWeekdays: [1, 3, 5],
      preferredMeetingLocation: 'Client Home',
      autoUseTrainerDefaultLocation: true,
    });
    await createTrainerClientScheduleException({
      accessToken: 'trainer-token',
      clientId: 'client-1',
      sessionDate: '2026-04-21',
      exceptionType: 'skip',
      meetingLocationOverride: null,
    });
    await deleteTrainerClientScheduleException({
      accessToken: 'trainer-token',
      clientId: 'client-1',
      sessionDate: '2026-04-21',
    });

    expect(fetchWithApiFallback).toHaveBeenNthCalledWith(
      1,
      '/api/v1/trainer-clients/client-1/schedule-preferences?date=2026-04-20',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchWithApiFallback).toHaveBeenNthCalledWith(
      2,
      '/api/v1/trainer-clients/client-1/schedule-preferences',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          recurring_weekdays: [1, 3, 5],
          preferred_meeting_location: 'Client Home',
          auto_use_trainer_default_location: true,
        }),
      }),
    );
    expect(fetchWithApiFallback).toHaveBeenNthCalledWith(
      3,
      '/api/v1/trainer-clients/client-1/schedule-exceptions',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          session_date: '2026-04-21',
          exception_type: 'skip',
          meeting_location_override: null,
        }),
      }),
    );
    expect(fetchWithApiFallback).toHaveBeenNthCalledWith(
      4,
      '/api/v1/trainer-clients/client-1/schedule-exceptions/2026-04-21',
      expect.objectContaining({
        method: 'DELETE',
      }),
    );
  });

  it('calls client read-only trainer schedule endpoint', async () => {
    await getMyTrainerSchedule({ accessToken: 'client-token' });
    expect(fetchWithApiFallback).toHaveBeenCalledWith(
      '/api/v1/profiles/me/trainer-schedule',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer client-token',
        }),
      }),
    );
  });
});

jest.mock('../../../../services/apiRequest', () => ({
  fetchWithApiFallback: jest.fn(),
}));

jest.mock('../../../../services/apiNetworkError', () => ({
  buildApiNetworkError: jest.fn((error) => error),
}));

import { fetchWithApiFallback } from '../../../../services/apiRequest';
import {
  getCheckinProgress,
  getLocalDateString,
  getPreviousCheckin,
  getTodayCheckin,
} from '../checkinApi';

function createOkResponse(payload = {}) {
  return {
    ok: true,
    text: jest.fn().mockResolvedValue(JSON.stringify(payload)),
  };
}

describe('checkinApi date defaults', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchWithApiFallback.mockResolvedValue({
      response: createOkResponse({ ok: true }),
      baseUrl: 'http://127.0.0.1:8000',
    });
  });

  it('formats a local calendar date string', () => {
    const date = new Date('2026-04-10T00:30:00-07:00');
    expect(getLocalDateString(date)).toBe('2026-04-10');
  });

  it('uses a local date by default for getTodayCheckin', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-10T23:30:00-07:00'));

    await getTodayCheckin({ accessToken: 'token' });

    expect(fetchWithApiFallback).toHaveBeenCalledWith(
      '/api/v1/checkin/today?request_date=2026-04-10',
      expect.objectContaining({
        method: 'GET',
      }),
    );

    jest.useRealTimers();
  });

  it('uses a local date by default for getPreviousCheckin', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-10T23:30:00-07:00'));

    await getPreviousCheckin({ accessToken: 'token' });

    expect(fetchWithApiFallback).toHaveBeenCalledWith(
      '/api/v1/checkin/previous?before_date=2026-04-10',
      expect.objectContaining({
        method: 'GET',
      }),
    );

    jest.useRealTimers();
  });

  it('uses a local date by default for getCheckinProgress', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-10T23:30:00-07:00'));

    await getCheckinProgress({ accessToken: 'token' });

    expect(fetchWithApiFallback).toHaveBeenCalledWith(
      '/api/v1/checkin/progress?as_of_date=2026-04-10',
      expect.objectContaining({
        method: 'GET',
      }),
    );

    jest.useRealTimers();
  });

  it('preserves explicit dates for historical queries', async () => {
    await getPreviousCheckin({ accessToken: 'token', beforeDate: '2026-04-08' });
    await getCheckinProgress({ accessToken: 'token', asOfDate: '2026-04-08' });

    expect(fetchWithApiFallback).toHaveBeenNthCalledWith(
      1,
      '/api/v1/checkin/previous?before_date=2026-04-08',
      expect.objectContaining({
        method: 'GET',
      }),
    );
    expect(fetchWithApiFallback).toHaveBeenNthCalledWith(
      2,
      '/api/v1/checkin/progress?as_of_date=2026-04-08',
      expect.objectContaining({
        method: 'GET',
      }),
    );
  });
});

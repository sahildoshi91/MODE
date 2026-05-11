jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  loadTrainerClientsSummaryVisibility,
  saveTrainerClientsSummaryVisibility,
} from '../trainerClientsSummaryVisibilityStorage';

describe('trainerClientsSummaryVisibilityStorage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('defaults to expanded when no stored preference exists', async () => {
    AsyncStorage.getItem.mockResolvedValue(null);

    const snapshot = await loadTrainerClientsSummaryVisibility('trainer-1');

    expect(snapshot).toEqual({ collapsed: false });
    expect(AsyncStorage.getItem).toHaveBeenCalledWith('trainer_clients_summary_visibility:v1:trainer-1');
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      'trainer_clients_summary_visibility:v1:trainer-1',
      JSON.stringify({ collapsed: false }),
    );
  });

  it('saves and reloads collapsed preference per trainer scope', async () => {
    const saved = await saveTrainerClientsSummaryVisibility('trainer-2', { collapsed: true });
    expect(saved).toEqual({ collapsed: true });
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      'trainer_clients_summary_visibility:v1:trainer-2',
      JSON.stringify({ collapsed: true }),
    );

    AsyncStorage.getItem.mockResolvedValueOnce(JSON.stringify({ collapsed: true }));
    const loaded = await loadTrainerClientsSummaryVisibility('trainer-2');
    expect(loaded).toEqual({ collapsed: true });
  });

  it('handles malformed payloads safely', async () => {
    AsyncStorage.getItem.mockResolvedValueOnce('{not-json');
    const malformedJsonSnapshot = await loadTrainerClientsSummaryVisibility('trainer-3');
    expect(malformedJsonSnapshot).toEqual({ collapsed: false });

    AsyncStorage.getItem.mockResolvedValueOnce(JSON.stringify({ collapsed: 'yes' }));
    const wrongTypeSnapshot = await loadTrainerClientsSummaryVisibility('trainer-3');
    expect(wrongTypeSnapshot).toEqual({ collapsed: false });
  });
});

jest.mock('../../../trainerClients/services/trainerHomeApi', () => ({
  createTrainerClientMemory: jest.fn(),
  getTrainerCommandCenter: jest.fn(),
  getTrainerClientAIContext: jest.fn(),
  getTrainerClientDetail: jest.fn(),
  listTrainerClients: jest.fn(),
  patchTrainerClientSchedulePreferences: jest.fn(),
}));

jest.mock('../../../trainerAssistant/services/trainerAssistantApi', () => ({
  getTrainerAssistantBootstrap: jest.fn(),
}));

jest.mock('../../storage/coachClientContextStorage', () => ({
  loadActiveCoachClientId: jest.fn(),
  loadRecentCoachClientIds: jest.fn(),
  pushRecentCoachClientId: jest.fn(),
  saveActiveCoachClientId: jest.fn(),
}));

import { createTrainerClientMemory } from '../../../trainerClients/services/trainerHomeApi';
import { saveClientNote } from '../coachClientContextApi';

describe('coachClientContextApi.saveClientNote', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    createTrainerClientMemory.mockResolvedValue({ id: 'memory-1' });
  });

  it('maps allowAIUse=true to ai_usable visibility and includes structured rail source metadata', async () => {
    await saveClientNote({
      accessToken: 'token',
      payload: {
        clientId: 'client-1',
        body: 'Keep intensity moderate this week.',
        allowAIUse: true,
        createdByTrainerId: 'trainer-1',
      },
    });

    expect(createTrainerClientMemory).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'token',
      clientId: 'client-1',
      visibility: 'ai_usable',
      text: 'Keep intensity moderate this week.',
      structuredData: expect.objectContaining({
        source: 'coach_chat_context_rail',
        created_by_trainer_id: 'trainer-1',
      }),
    }));
  });

  it('maps allowAIUse=false to internal_only visibility', async () => {
    await saveClientNote({
      accessToken: 'token',
      payload: {
        clientId: 'client-2',
        body: 'Private note only.',
        allowAIUse: false,
        createdByTrainerId: 'trainer-1',
      },
    });

    expect(createTrainerClientMemory).toHaveBeenCalledWith(expect.objectContaining({
      clientId: 'client-2',
      visibility: 'internal_only',
    }));
  });
});

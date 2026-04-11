jest.mock('../../services/trainerKnowledgeApi', () => ({
  archiveTrainerRule: jest.fn().mockResolvedValue({}),
  createTrainerKnowledgeDocument: jest.fn().mockResolvedValue({}),
  ingestTrainerKnowledgeDocument: jest.fn().mockResolvedValue({
    extraction: { rules_created: 0 },
  }),
  listTrainerKnowledgeDocuments: jest.fn(),
  listTrainerRules: jest.fn(),
  updateTrainerRule: jest.fn().mockResolvedValue({}),
}));

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaProvider: ({ children }) => children,
    SafeAreaView: ({ children }) => React.createElement('SafeAreaView', null, children),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import TrainerHomeScreen from '../TrainerHomeScreen';
import {
  listTrainerKnowledgeDocuments,
  listTrainerRules,
} from '../../services/trainerKnowledgeApi';

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('TrainerHomeScreen smoke', () => {
  beforeEach(() => {
    listTrainerKnowledgeDocuments.mockResolvedValue([
      {
        id: 'doc-1',
        title: 'Progression Notes',
        document_type: 'text',
        created_at: '2026-04-11T10:00:00+00:00',
      },
    ]);
    listTrainerRules.mockResolvedValue([
      {
        id: 'rule-1',
        category: 'progression_logic',
        rule_text: 'Progress load only when form is stable.',
        confidence: 0.9,
        current_version: 1,
        is_archived: false,
      },
    ]);
  });

  it('renders trainer Agent Lab surface and loads trainer data', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <SafeAreaProvider>
          <TrainerHomeScreen
            accessToken="trainer-access-token"
            viewerDisplayName="Coach Maya"
            trainerOnboardingCompleted
          />
        </SafeAreaProvider>,
      );
    });

    await flushEffects();

    const rendered = JSON.stringify(tree.toJSON());
    expect(rendered).toContain('Agent Lab');
    expect(rendered).toContain('Quick Capture');
    expect(rendered).toContain('Saved Knowledge');
    expect(rendered).toContain('Extracted Rules');
    expect(rendered).toContain('Progression Notes');
    expect(listTrainerKnowledgeDocuments).toHaveBeenCalledWith({
      accessToken: 'trainer-access-token',
    });
    expect(listTrainerRules).toHaveBeenCalledWith({
      accessToken: 'trainer-access-token',
    });
  });

  it('renders an actionable load error when knowledge fetch fails', async () => {
    listTrainerKnowledgeDocuments.mockRejectedValueOnce(
      new Error('Unable to reach trainer knowledge service.'),
    );
    listTrainerRules.mockResolvedValueOnce([]);

    let tree;
    await act(async () => {
      tree = renderer.create(
        <SafeAreaProvider>
          <TrainerHomeScreen
            accessToken="trainer-access-token"
            viewerDisplayName="Coach Maya"
            trainerOnboardingCompleted
          />
        </SafeAreaProvider>,
      );
    });

    await flushEffects();

    const rendered = JSON.stringify(tree.toJSON());
    expect(rendered).toContain('Unable to reach trainer knowledge service.');
  });
});

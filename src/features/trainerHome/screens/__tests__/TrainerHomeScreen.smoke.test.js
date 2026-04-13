jest.mock('../../services/trainerKnowledgeApi', () => ({
  archiveTrainerRule: jest.fn().mockResolvedValue({}),
  createTrainerKnowledgeDocument: jest.fn().mockResolvedValue({}),
  ingestTrainerKnowledgeDocument: jest.fn().mockResolvedValue({
    extraction: { rules_created: 0 },
  }),
  listTrainerKnowledgeDocuments: jest.fn(),
  listTrainerRules: jest.fn(),
  saveTrainerKnowledgeDocumentWithFallback: jest.fn(),
  updateTrainerKnowledgeDocument: jest.fn(),
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
  saveTrainerKnowledgeDocumentWithFallback,
  updateTrainerKnowledgeDocument,
} from '../../services/trainerKnowledgeApi';

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderScreen() {
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
  return tree;
}

describe('TrainerHomeScreen smoke', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    listTrainerKnowledgeDocuments.mockResolvedValue([
      {
        id: 'doc-1',
        title: 'Progression Notes',
        document_type: 'text',
        raw_text: 'Start with movement quality before adding load.',
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
    saveTrainerKnowledgeDocumentWithFallback.mockResolvedValue({
      document: {
        id: 'doc-2',
        title: 'Saved',
      },
      extracted_rules: [],
      extraction: {
        rules_created: 0,
        fallback_reason: null,
      },
      fallback_used: false,
      ingest_error: null,
    });
    updateTrainerKnowledgeDocument.mockResolvedValue({
      document: {
        id: 'doc-1',
        title: 'Updated Progression Notes',
        document_type: 'text',
        raw_text: 'Updated text.',
        created_at: '2026-04-11T10:00:00+00:00',
      },
      extracted_rules: [],
      extraction: {
        rules_created: 1,
        fallback_reason: null,
      },
    });
  });

  it('renders trainer Agent Lab surface and loads trainer data', async () => {
    const tree = await renderScreen();
    const rendered = JSON.stringify(tree.toJSON());
    expect(rendered).toContain('Agent Lab');
    expect(rendered).toContain('Quick Capture');
    expect(rendered).toContain('Saved Knowledge');
    expect(rendered).toContain('Extracted Rules');
    expect(rendered).toContain('Progression Notes');
    expect(rendered).not.toContain('Date unavailable');
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

    const tree = await renderScreen();
    const rendered = JSON.stringify(tree.toJSON());
    expect(rendered).toContain('Unable to reach trainer knowledge service.');
  });

  it('shows an inline quick capture validation error when quick capture is empty', async () => {
    const tree = await renderScreen();

    const quickCaptureSaveButton = tree.root.findByProps({
      testID: 'trainer-home-save-quick-capture',
    });
    await act(async () => {
      quickCaptureSaveButton.props.onPress();
    });

    const rendered = JSON.stringify(tree.toJSON());
    expect(rendered).toContain('Share one coaching principle before saving quick capture.');
  });

  it('clears quick capture input and shows success after save', async () => {
    saveTrainerKnowledgeDocumentWithFallback.mockResolvedValueOnce({
      document: {
        id: 'doc-2',
        title: 'Quick Capture',
      },
      extracted_rules: [],
      extraction: {
        rules_created: 2,
        fallback_reason: null,
      },
      fallback_used: false,
      ingest_error: null,
    });

    const tree = await renderScreen();

    const quickCaptureInput = tree.root.findByProps({
      testID: 'trainer-home-quick-capture-input',
    });
    const quickCaptureSaveButton = tree.root.findByProps({
      testID: 'trainer-home-save-quick-capture',
    });

    await act(async () => {
      quickCaptureInput.props.onChangeText('If stress is high, reduce intensity first.');
    });
    await act(async () => {
      await quickCaptureSaveButton.props.onPress();
    });
    await flushEffects();

    expect(saveTrainerKnowledgeDocumentWithFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'trainer-access-token',
        rawText: 'If stress is high, reduce intensity first.',
        metadata: expect.objectContaining({ source: 'agent_lab_quick_capture' }),
      }),
    );
    expect(
      tree.root.findByProps({
        testID: 'trainer-home-quick-capture-input',
      }).props.value,
    ).toBe('');

    const rendered = JSON.stringify(tree.toJSON());
    expect(rendered).toContain('Saved and extracted 2 coaching rules.');
  });

  it('shows soft extraction note and refreshes list when save falls back to raw document', async () => {
    saveTrainerKnowledgeDocumentWithFallback.mockResolvedValueOnce({
      document: {
        id: 'doc-3',
        title: 'Methodology',
      },
      extracted_rules: [],
      extraction: {
        rules_created: 0,
        fallback_reason: 'ingest_request_failed',
      },
      fallback_used: true,
      ingest_error: { message: 'ingest failed' },
    });
    listTrainerKnowledgeDocuments.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 'doc-3',
        title: 'Methodology',
        document_type: 'text',
        created_at: '2026-04-13T10:00:00+00:00',
      },
    ]);

    const tree = await renderScreen();

    const titleInput = tree.root.findByProps({
      testID: 'trainer-home-methodology-title-input',
    });
    const rawInput = tree.root.findByProps({
      testID: 'trainer-home-methodology-raw-input',
    });
    const saveMethodologyButton = tree.root.findByProps({
      testID: 'trainer-home-save-methodology',
    });

    await act(async () => {
      titleInput.props.onChangeText('Methodology');
      rawInput.props.onChangeText('Progress load when reps stay clean.');
    });
    await act(async () => {
      await saveMethodologyButton.props.onPress();
    });
    await flushEffects();

    const rendered = JSON.stringify(tree.toJSON());
    expect(rendered).toContain('Rule extraction is still processing. You can retry later.');
    expect(rendered).toContain('Methodology');
    expect(listTrainerKnowledgeDocuments).toHaveBeenCalledTimes(2);
  });

  it('opens, edits, and resaves a saved knowledge document', async () => {
    updateTrainerKnowledgeDocument.mockResolvedValueOnce({
      document: {
        id: 'doc-1',
        title: 'Updated Progression Notes',
        document_type: 'text',
        raw_text: 'New saved content',
        created_at: '2026-04-11T10:00:00+00:00',
      },
      extracted_rules: [],
      extraction: {
        rules_created: 1,
        fallback_reason: null,
      },
    });

    const tree = await renderScreen();
    const openDocButton = tree.root.findByProps({
      testID: 'trainer-home-open-saved-doc-doc-1',
    });

    await act(async () => {
      openDocButton.props.onPress();
    });

    const editDocButton = tree.root.findByProps({
      testID: 'trainer-home-edit-saved-doc',
    });
    await act(async () => {
      editDocButton.props.onPress();
    });

    const titleInput = tree.root.findByProps({
      testID: 'trainer-home-saved-doc-title-input',
    });
    const rawInput = tree.root.findByProps({
      testID: 'trainer-home-saved-doc-raw-input',
    });
    await act(async () => {
      titleInput.props.onChangeText('Updated Progression Notes');
      rawInput.props.onChangeText('New saved content');
    });

    const saveButton = tree.root.findByProps({
      testID: 'trainer-home-save-saved-doc',
    });
    await act(async () => {
      await saveButton.props.onPress();
    });
    await flushEffects();

    expect(updateTrainerKnowledgeDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'trainer-access-token',
        documentId: 'doc-1',
        title: 'Updated Progression Notes',
        rawText: 'New saved content',
      }),
    );

    const rendered = JSON.stringify(tree.toJSON());
    expect(rendered).toContain('Saved changes.');
  });

  it('shows a refreshing state while Saved Knowledge is refreshing', async () => {
    let resolveRefresh;
    const refreshPromise = new Promise((resolve) => {
      resolveRefresh = resolve;
    });
    listTrainerKnowledgeDocuments
      .mockResolvedValueOnce([
        {
          id: 'doc-1',
          title: 'Progression Notes',
          document_type: 'text',
          created_at: '2026-04-11T10:00:00+00:00',
        },
      ])
      .mockImplementationOnce(() => refreshPromise);
    listTrainerRules.mockResolvedValue([]);

    const tree = await renderScreen();
    const refreshButton = tree.root.findByProps({
      testID: 'trainer-home-saved-knowledge-refresh',
    });

    await act(async () => {
      refreshButton.props.onPress();
      await Promise.resolve();
    });

    const refreshingButton = tree.root.findByProps({
      testID: 'trainer-home-saved-knowledge-refresh',
    });
    expect(refreshingButton.props.title).toBe('Refreshing...');
    expect(refreshingButton.props.disabled).toBe(true);

    await act(async () => {
      resolveRefresh([
        {
          id: 'doc-1',
          title: 'Progression Notes',
          document_type: 'text',
          created_at: '2026-04-11T10:00:00+00:00',
        },
      ]);
      await refreshPromise;
    });
    await flushEffects();
  });
});

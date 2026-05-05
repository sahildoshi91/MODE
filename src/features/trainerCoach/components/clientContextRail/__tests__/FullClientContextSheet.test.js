import React from 'react';
import renderer, { act } from 'react-test-renderer';

jest.mock('../../../../../../lib/components', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    ModeButton: ({ title, ...props }) => <Text {...props}>{title}</Text>,
    ModeText: ({ children, ...props }) => <Text {...props}>{children}</Text>,
  };
});

import FullClientContextSheet from '../FullClientContextSheet';

function renderText(tree) {
  return JSON.stringify(tree.toJSON());
}

const summary = {
  detail: {
    profile_snapshot: {
      user_why: 'Dance until I am 100 and never tell my kids I am tired.',
    },
    activity_summary: {
      avg_score_7d: 18,
      latest_checkin_date: '2026-05-04',
      session_status: 'scheduled',
    },
    schedule_preferences: {
      preferred_meeting_location: 'Studio A',
    },
  },
  aiContext: {
    applied_ai_usable_memory: [],
    internal_only_memory_count: 0,
    profile_snapshot: {
      user_why: 'Dance until I am 100 and never tell my kids I am tired.',
    },
    context_preview_text: 'Motivation baseline: Dance until I am 100.',
  },
};

describe('FullClientContextSheet', () => {
  it('renders Your Why in client details', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <FullClientContextSheet
          section="client_details"
          summary={summary}
          onBack={() => {}}
        />,
      );
    });

    expect(renderText(tree)).toContain('Your Why: Dance until I am 100');
  });

  it('renders Your Why in advanced AI context', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <FullClientContextSheet
          section="advanced_ai_context"
          summary={summary}
          onBack={() => {}}
        />,
      );
    });

    const text = renderText(tree);
    expect(text).toContain('Your Why: Dance until I am 100');
    expect(text).toContain('Motivation baseline: Dance until I am 100');
  });
});

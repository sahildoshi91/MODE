jest.mock('../../services/profileApi', () => ({
  getMyTrainerSchedule: jest.fn(),
  getTrainerSettingsMe: jest.fn(),
  patchTrainerSettingsMe: jest.fn(),
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

import ProfileScreen from '../ProfileScreen';
import { getMyTrainerSchedule, getTrainerSettingsMe, patchTrainerSettingsMe } from '../../services/profileApi';

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('ProfileScreen trainer schedule', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getMyTrainerSchedule.mockResolvedValue({
      client_id: 'client-1',
      trainer_id: 'trainer-1',
      trainer_display_name: 'Coach Alex',
      recurring_weekdays: [1, 3, 5],
      upcoming_exceptions: [
        {
          client_id: 'client-1',
          session_date: '2026-04-22',
          exception_type: 'skip',
          meeting_location_override: null,
        },
      ],
      resolved_default_meeting_location: 'My Gym',
    });
    getTrainerSettingsMe.mockResolvedValue({
      trainer_id: 'trainer-1',
      default_meeting_location: 'My Gym',
      auto_fill_meeting_location: true,
      assistant_display_name: null,
    });
    patchTrainerSettingsMe.mockResolvedValue({
      trainer_id: 'trainer-1',
      default_meeting_location: 'My Gym',
      auto_fill_meeting_location: true,
      assistant_display_name: 'Atlas',
    });
  });

  it('renders client read-only trainer schedule section', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <ProfileScreen
          session={{ user: { email: 'client@example.com' } }}
          assignmentStatus={{
            viewer_role: 'client',
            assigned_trainer_display_name: 'Coach Alex',
          }}
          accessToken="client-token"
          onSignOut={() => {}}
          bottomInset={0}
        />,
      );
    });
    await flushEffects();

    const rendered = JSON.stringify(tree.toJSON());
    expect(rendered).toContain('Trainer Schedule');
    expect(rendered).toContain('Weekly Days:');
    expect(rendered).toContain('Mon, Wed, Fri');
    expect(rendered).toContain('Typical Location:');
    expect(rendered).toContain('My Gym');
    expect(rendered).toContain('view-only');
    expect(getMyTrainerSchedule).toHaveBeenCalledWith({ accessToken: 'client-token' });
  });

  it('renders assistant naming controls for trainer and persists custom assistant display name', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <ProfileScreen
          session={{ user: { email: 'trainer@example.com' } }}
          assignmentStatus={{
            viewer_role: 'trainer',
            assigned_trainer_display_name: 'Coach Alex',
          }}
          accessToken="trainer-token"
          onSignOut={() => {}}
          bottomInset={0}
        />,
      );
    });
    await flushEffects();

    let rendered = JSON.stringify(tree.toJSON());
    expect(rendered).toContain('Name your assistant');
    expect(rendered).toContain('This is what your internal coaching AI will be called in your workspace.');
    expect(rendered).toContain('Preview: Trainer and');
    expect(rendered).toContain('Coach AI');

    const assistantNameInput = tree.root.find(
      (node) => node?.props?.placeholder === 'Coach AI' && typeof node?.props?.onChangeText === 'function',
    );
    act(() => {
      assistantNameInput.props.onChangeText('  Atlas  ');
    });

    rendered = JSON.stringify(tree.toJSON());
    expect(rendered).toContain('Preview: Trainer and');
    expect(rendered).toContain('Atlas');

    const saveButton = tree.root.find(
      (node) => node?.props?.title === 'Save Trainer Defaults' && typeof node?.props?.onPress === 'function',
    );
    await act(async () => {
      await saveButton.props.onPress();
    });

    expect(patchTrainerSettingsMe).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'trainer-token',
      assistantDisplayName: 'Atlas',
    }));

    await act(async () => {
      tree.unmount();
    });
  });
});

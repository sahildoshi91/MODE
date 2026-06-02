jest.mock('../../services/profileApi', () => ({
  getMyTrainerSchedule: jest.fn(),
  getTrainerSettingsMe: jest.fn(),
  patchTrainerSettingsMe: jest.fn(),
}));

jest.mock('../../../../config/legalLinks', () => ({
  AI_FITNESS_DISCLAIMER:
    'MODE provides AI-generated fitness coaching and accountability. It is not medical advice and is not a substitute for a doctor, physical therapist, registered dietitian, or other qualified professional. Stop exercising and seek professional advice if you experience pain, dizziness, or concerning symptoms.',
  getLegalLinks: jest.fn(),
  getLegalLinksFallbackText: jest.fn((links) => {
    const missingEnvVars = links
      .filter((link) => !link.isConfigured)
      .map((link) => link.envVar);
    if (missingEnvVars.length === 0) {
      return null;
    }
    return `Configure ${missingEnvVars.join(', ')} to enable these links.`;
  }),
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
import { Linking } from 'react-native';
import renderer, { act } from 'react-test-renderer';

import ProfileScreen from '../ProfileScreen';
import { getLegalLinks, getLegalLinksFallbackText } from '../../../../config/legalLinks';
import { getMyTrainerSchedule, getTrainerSettingsMe, patchTrainerSettingsMe } from '../../services/profileApi';

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function buildLegalLinks({ includeSupport = true } = {}) {
  return [
    {
      id: 'privacy',
      label: 'Privacy Policy',
      envVar: 'EXPO_PUBLIC_PRIVACY_POLICY_URL',
      url: 'https://modefit.ai/privacy',
      isConfigured: true,
    },
    {
      id: 'terms',
      label: 'Terms',
      envVar: 'EXPO_PUBLIC_TERMS_URL',
      url: 'https://modefit.ai/terms',
      isConfigured: true,
    },
    {
      id: 'support',
      label: 'Support',
      envVar: 'EXPO_PUBLIC_SUPPORT_URL',
      url: includeSupport ? 'https://modefit.ai/support' : null,
      isConfigured: includeSupport,
    },
  ];
}

function pressByTestId(tree, testID) {
  const node = tree.root.findByProps({ testID });
  act(() => {
    node.props.onPress();
  });
}

describe('ProfileScreen trainer schedule', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Linking.openURL = jest.fn().mockResolvedValue(true);
    getLegalLinks.mockReturnValue(buildLegalLinks());
    getLegalLinksFallbackText.mockImplementation((links) => {
      const missingEnvVars = links
        .filter((link) => !link.isConfigured)
        .map((link) => link.envVar);
      if (missingEnvVars.length === 0) {
        return null;
      }
      return `Configure ${missingEnvVars.join(', ')} to enable these links.`;
    });
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

  it('renders the root settings menu without the moved drill-down content', async () => {
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
    expect(rendered).toContain('Profile');
    expect(rendered).toContain('Account');
    expect(rendered).toContain('Personalization');
    expect(rendered).toContain('Trainer Schedule');
    expect(rendered).toContain('AI Fitness Guidance');
    expect(rendered).toContain('Legal & Support');
    expect(rendered).not.toContain('Delete Account');
    expect(rendered).toContain('Sign out');
    expect(rendered).not.toContain('AI-generated fitness coaching');
    expect(rendered).not.toContain('Weekly Days:');
  });

  it('renders client read-only trainer schedule after drilling in', async () => {
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

    pressByTestId(tree, 'profile-settings-nav-trainer-schedule');

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

    pressByTestId(tree, 'profile-settings-nav-trainer-defaults');

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

  it('requires DELETE confirmation before account deletion and calls onDeleteAccount', async () => {
    const onDeleteAccount = jest.fn().mockResolvedValue(undefined);
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
          onDeleteAccount={onDeleteAccount}
          bottomInset={0}
        />,
      );
    });
    await flushEffects();

    pressByTestId(tree, 'profile-settings-nav-account');

    let rendered = JSON.stringify(tree.toJSON());
    expect(rendered).toContain('Submits a permanent deletion request');
    expect(rendered).toContain('Processing may continue after sign-out');
    expect(rendered).not.toContain('Sign out');

    const deleteButton = tree.root.find(
      (node) => node?.props?.title === 'Submit Deletion Request' && typeof node?.props?.onPress === 'function',
    );

    await act(async () => {
      await deleteButton.props.onPress();
    });

    rendered = JSON.stringify(tree.toJSON());
    expect(rendered).toContain('Type DELETE to confirm');
    expect(rendered).toContain('submit your account deletion request');
    expect(onDeleteAccount).not.toHaveBeenCalled();

    const confirmationInput = tree.root.find(
      (node) => node?.props?.placeholder === 'Type DELETE to confirm' && typeof node?.props?.onChangeText === 'function',
    );
    act(() => {
      confirmationInput.props.onChangeText('DELETE');
    });

    await act(async () => {
      await deleteButton.props.onPress();
    });

    expect(onDeleteAccount).toHaveBeenCalledWith({ confirmation: 'DELETE' });
    rendered = JSON.stringify(tree.toJSON());
    expect(rendered).toContain('Account deletion request submitted');
  });

  it('renders AI guidance in its own drill-down screen', async () => {
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

    pressByTestId(tree, 'profile-settings-nav-ai-guidance');

    tree.root.findByProps({ testID: 'profile-ai-fitness-disclaimer' });
    expect(JSON.stringify(tree.toJSON())).toContain('AI-generated fitness coaching');
  });

  it('opens configured legal links from Legal & Support', async () => {
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

    pressByTestId(tree, 'profile-settings-nav-legal-support');

    const rendered = JSON.stringify(tree.toJSON());
    expect(rendered).toContain('Privacy Policy');
    expect(rendered).toContain('Terms');
    expect(rendered).toContain('Support');

    const privacyLink = tree.root.findByProps({ testID: 'profile-legal-link-privacy' });
    const termsLink = tree.root.findByProps({ testID: 'profile-legal-link-terms' });
    const supportLink = tree.root.findByProps({ testID: 'profile-legal-link-support' });
    await act(async () => {
      await privacyLink.props.onPress();
      await termsLink.props.onPress();
      await supportLink.props.onPress();
    });

    expect(Linking.openURL).toHaveBeenCalledWith('https://modefit.ai/privacy');
    expect(Linking.openURL).toHaveBeenCalledWith('https://modefit.ai/terms');
    expect(Linking.openURL).toHaveBeenCalledWith('https://modefit.ai/support');
  });

  it('does not render unconfigured legal link rows', async () => {
    getLegalLinks.mockReturnValue(buildLegalLinks({ includeSupport: false }));
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

    pressByTestId(tree, 'profile-settings-nav-legal-support');

    expect(() => tree.root.findByProps({ testID: 'profile-legal-link-support' })).toThrow();
    tree.root.findByProps({ testID: 'profile-legal-links-fallback' });
    expect(JSON.stringify(tree.toJSON())).toContain('EXPO_PUBLIC_SUPPORT_URL');
  });

  it('renders diagnostics from the guarded root row when enabled', async () => {
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

    pressByTestId(tree, 'profile-settings-nav-diagnostics');

    const rendered = JSON.stringify(tree.toJSON());
    expect(rendered).toContain('Diagnostics');
    expect(rendered).toContain('Environment');
    expect(rendered).toContain('API Base');
  });
});

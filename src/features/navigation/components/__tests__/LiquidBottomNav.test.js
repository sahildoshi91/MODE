import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { StyleSheet } from 'react-native';

import LiquidBottomNav, {
  NAV_BOTTOM_OFFSET,
  NAV_PILL_HEIGHT,
} from '../LiquidBottomNav';
import { theme } from '../../../../../lib/theme';

jest.mock('lucide-react-native', () => {
  const React = require('react');

  const MockIcon = (props) => React.createElement('MockIcon', props);

  return {
    BarChart3: MockIcon,
    Dumbbell: MockIcon,
    Home: MockIcon,
    User: MockIcon,
    Users: MockIcon,
  };
});

function flatten(style) {
  return StyleSheet.flatten(style);
}

describe('LiquidBottomNav premium contract', () => {
  it('exposes reduced premium nav sizing constants', () => {
    expect(NAV_PILL_HEIGHT).toBe(56);
    expect(NAV_BOTTOM_OFFSET).toBe(8);
  });

  it('applies active emphasis to the selected tab', () => {
    let tree;
    act(() => {
      tree = renderer.create(
        <LiquidBottomNav
          activeTab="clients"
          onTabChange={() => {}}
          role="trainer"
          trainerNavMode="coach_os"
          bottomInset={0}
        />,
      );
    });

    const selectedButton = tree.root.find((node) => (
      node.props?.accessibilityRole === 'button'
      && node.props?.accessibilityState?.selected === true
      && typeof node.props?.style === 'function'
    ));
    const selectedStyle = flatten(selectedButton.props.style({ pressed: false }));
    expect(selectedStyle.shadowOpacity).toBeGreaterThan(0);

    const selectedLabel = tree.root.find((node) => node.props?.children === 'Clients');
    expect(flatten(selectedLabel.props.style).color).toBe(theme.colors.nav.activeLabel);

    act(() => tree.unmount());
  });
});


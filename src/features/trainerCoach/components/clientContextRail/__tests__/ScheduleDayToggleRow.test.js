import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { StyleSheet, Text, View } from 'react-native';

jest.mock('../../../../../../lib/components', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    ModeText: ({ children, ...props }) => <Text {...props}>{children}</Text>,
  };
});

import ScheduleDayToggleRow from '../ScheduleDayToggleRow';

const DAYS = [
  { key: 1, label: 'Monday' },
  { key: 2, label: 'Tuesday' },
  { key: 3, label: 'Wednesday' },
  { key: 4, label: 'Thursday' },
  { key: 5, label: 'Friday' },
  { key: 6, label: 'Saturday' },
  { key: 7, label: 'Sunday' },
];

describe('ScheduleDayToggleRow', () => {
  it('renders a single-row weekday control set with accessibility labels', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <ScheduleDayToggleRow
          selectedDays={[1, 3]}
          onToggle={() => {}}
          testIDPrefix="weekday"
        />,
      );
    });

    DAYS.forEach((day) => {
      const button = tree.root.findByProps({ testID: `weekday-${day.key}` });
      expect(button.props.accessibilityLabel).toBe(day.label);
    });

    const rootRow = tree.root.findAllByType(View)[0];
    const flattened = StyleSheet.flatten(rootRow.props.style);
    expect(flattened.flexDirection).toBe('row');
    expect(flattened.flexWrap).toBeUndefined();

    await act(async () => {
      tree.unmount();
    });
  });
});

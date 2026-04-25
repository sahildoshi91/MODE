import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';

jest.mock('../../../../../../lib/components', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    ModeText: ({ children, ...props }) => <Text {...props}>{children}</Text>,
  };
});

import SmartClientPicker from '../SmartClientPicker';

function buildClient(id, name, overrides = {}) {
  return {
    id,
    name,
    initials: name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase(),
    isToday: false,
    ...overrides,
  };
}

describe('SmartClientPicker', () => {
  it('renders sections in Today, Recent, then All Clients order', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <SmartClientPicker
          selectedClientId={null}
          todayClients={[buildClient('client-1', 'Sarah Johnson', { isToday: true })]}
          recentClients={[buildClient('client-2', 'Jordan Lee')]}
          allClients={[
            buildClient('client-1', 'Sarah Johnson'),
            buildClient('client-2', 'Jordan Lee'),
            buildClient('client-3', 'Ava Smith'),
          ]}
          searchQuery=""
          onSearchQueryChange={() => {}}
          onSelectClient={() => {}}
          testIDPrefix="picker"
        />,
      );
    });

    const rowTestIds = tree.root.findAll((node) => (
      typeof node.props?.testID === 'string'
      && node.props.testID.startsWith('picker-')
      && node.props.testID.includes('client-')
    )).map((node) => node.props.testID);
    const uniqueRowTestIds = rowTestIds.filter(
      (testID, index) => rowTestIds.indexOf(testID) === index,
    );

    expect(uniqueRowTestIds).toEqual([
      'picker-today-client-1',
      'picker-recent-client-2',
      'picker-all-clients-client-3',
    ]);

    await act(async () => {
      tree.unmount();
    });
  });

  it('filters client rows in-place when search query is provided', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <SmartClientPicker
          selectedClientId={null}
          todayClients={[buildClient('client-1', 'Sarah Johnson', { isToday: true })]}
          recentClients={[
            buildClient('client-2', 'Jordan Lee'),
            buildClient('client-1', 'Sarah Johnson'),
          ]}
          allClients={[
            buildClient('client-1', 'Sarah Johnson'),
            buildClient('client-2', 'Jordan Lee'),
            buildClient('client-3', 'Ava Smith'),
          ]}
          searchQuery="Jordan"
          onSearchQueryChange={() => {}}
          onSelectClient={() => {}}
          testIDPrefix="picker"
        />,
      );
    });

    expect(() => tree.root.findByProps({ testID: 'picker-recent-client-2' })).not.toThrow();
    expect(() => tree.root.findByProps({ testID: 'picker-today-client-1' })).toThrow();
    expect(() => tree.root.findByProps({ testID: 'picker-all-clients-client-3' })).toThrow();

    await act(async () => {
      tree.unmount();
    });
  });
});

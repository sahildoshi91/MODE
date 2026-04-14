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

import TrainerAssignmentScreen from '../TrainerAssignmentScreen';

async function renderScreen(overrides = {}) {
  let tree;
  await act(async () => {
    tree = renderer.create(
      <SafeAreaProvider>
        <TrainerAssignmentScreen
          trainers={[]}
          availableTrainerCount={0}
          hasLoadedStatus={false}
          isStatusLoading={false}
          statusLoadFailed
          isSubmitting={false}
          errorMessage="Unable to reach the backend."
          isNetworkError
          errorRequestId={null}
          errorApiBase="http://192.168.0.10:8000"
          errorAttemptedBases={['http://192.168.0.10:8000', 'http://192.168.0.22:8000']}
          errorRawNetworkMessage="fetch failed"
          onRetryStatusLoad={jest.fn()}
          onAssignTrainer={jest.fn()}
          {...overrides}
        />
      </SafeAreaProvider>,
    );
  });
  return tree;
}

describe('TrainerAssignmentScreen', () => {
  it('renders network diagnostics for blocking status load failures', async () => {
    const tree = await renderScreen();
    const rendered = JSON.stringify(tree.toJSON());

    expect(rendered).toContain('Unable to load coach options');
    expect(rendered).toContain('Backend unreachable');
    expect(rendered).toContain('Tried hosts:');
    expect(rendered).toContain('http://192.168.0.10:8000, http://192.168.0.22:8000');
    expect(rendered).toContain('Network detail:');
    expect(rendered).toContain('fetch failed');
    expect(rendered).toContain('Resolved API Base:');
    expect(rendered).toContain('http://192.168.0.10:8000');
  });

  it('keeps retry action available after diagnostic rendering', async () => {
    const onRetryStatusLoad = jest.fn();
    const tree = await renderScreen({ onRetryStatusLoad });

    const retryButton = tree.root.findByProps({
      testID: 'trainer-assignment-retry-button',
    });

    await act(async () => {
      retryButton.props.onPress();
    });

    expect(onRetryStatusLoad).toHaveBeenCalledTimes(1);
  });
});

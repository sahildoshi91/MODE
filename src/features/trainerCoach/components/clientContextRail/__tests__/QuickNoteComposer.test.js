import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text, TextInput } from 'react-native';

jest.mock('@expo/vector-icons/Feather', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return function MockFeather({ name }) {
    return <Text>{name}</Text>;
  };
});

jest.mock('../../../../../../lib/components', () => {
  const React = require('react');
  const { Text, TextInput } = require('react-native');
  return {
    ModeInput: React.forwardRef((props, ref) => <TextInput ref={ref} {...props} />),
    ModeText: ({ children, ...props }) => <Text {...props}>{children}</Text>,
  };
});

import QuickNoteComposer from '../QuickNoteComposer';

describe('QuickNoteComposer', () => {
  it('auto-focuses the note field and shows save only when text exists', async () => {
    const onSave = jest.fn();
    let tree;

    await act(async () => {
      tree = renderer.create(
        <QuickNoteComposer
          quickNoteText=""
          isSavingNote={false}
          saveStatus="idle"
          saveMessage={null}
          hasSelectedClient
          onQuickNoteTextChange={() => {}}
          onSave={onSave}
          autoFocus
          focusSignal={1}
          testIDPrefix="note"
        />,
      );
    });

    expect(tree.root.findByType(TextInput).props.autoFocus).toBe(true);
    expect(() => tree.root.findByProps({ testID: 'note-save' })).toThrow();

    await act(async () => {
      tree.update(
        <QuickNoteComposer
          quickNoteText="Watch left knee on squats"
          isSavingNote={false}
          saveStatus="idle"
          saveMessage={null}
          hasSelectedClient
          onQuickNoteTextChange={() => {}}
          onSave={onSave}
          autoFocus
          focusSignal={1}
          testIDPrefix="note"
        />,
      );
    });

    const saveButton = tree.root.findByProps({ testID: 'note-save' });
    await act(async () => {
      saveButton.props.onPress();
    });

    expect(onSave).toHaveBeenCalledTimes(1);

    await act(async () => {
      tree.unmount();
    });
  });

  it('renders a subtle saved confirmation', async () => {
    let tree;

    await act(async () => {
      tree = renderer.create(
        <QuickNoteComposer
          quickNoteText=""
          isSavingNote={false}
          saveStatus="saved"
          saveMessage="Note saved"
          hasSelectedClient
          onQuickNoteTextChange={() => {}}
          onSave={() => {}}
          testIDPrefix="note"
        />,
      );
    });

    expect(JSON.stringify(tree.toJSON())).toContain('Note saved');

    await act(async () => {
      tree.unmount();
    });
  });
});

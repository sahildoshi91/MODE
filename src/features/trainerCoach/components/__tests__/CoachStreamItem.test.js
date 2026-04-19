import React from 'react';
import renderer, { act } from 'react-test-renderer';

import CoachStreamItem from '../CoachStreamItem';

async function expectLabelForKind(kind, label) {
  let tree;
  await act(async () => {
    tree = renderer.create(
      <CoachStreamItem item={{ kind, text: 'Sample text' }} />,
    );
  });
  const labelNodes = tree.root.findAll(
    (node) => node?.props?.children === label,
  );
  expect(labelNodes.length).toBeGreaterThan(0);
  await act(async () => {
    tree.unmount();
  });
}

describe('CoachStreamItem', () => {
  it('renders non-ambiguous labels for private/system/public message kinds', async () => {
    await expectLabelForKind('internal_ai_private', 'Internal AI');
    await expectLabelForKind('system_confirmation', 'System');
    await expectLabelForKind('client_message_draft', 'Client Draft');
    await expectLabelForKind('client_message_sent', 'Client Sent');
  });
});

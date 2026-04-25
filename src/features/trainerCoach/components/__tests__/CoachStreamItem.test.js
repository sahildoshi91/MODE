import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { StyleSheet, Text } from 'react-native';

import CoachStreamItem from '../CoachStreamItem';

async function expectLabelForKind(kind, label, assistantDisplayName = null) {
  let tree;
  await act(async () => {
    tree = renderer.create(
      <CoachStreamItem
        item={{ kind, text: 'Sample text' }}
        assistantDisplayName={assistantDisplayName}
      />,
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
    await expectLabelForKind('internal_ai_private', 'Atlas', 'Atlas');
    await expectLabelForKind('system_confirmation', 'System');
    await expectLabelForKind('client_message_draft', 'Client Draft');
    await expectLabelForKind('client_message_sent', 'Client Sent');
  });

  it('renders trainer input text with high-contrast color for readability', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <CoachStreamItem item={{ kind: 'trainer_input', text: 'Sample text' }} />,
      );
    });

    const messageNode = tree.root.find(
      (node) => node.type === Text && node?.props?.children === 'Sample text',
    );
    const flattened = StyleSheet.flatten(messageNode.props.style);
    expect(flattened?.color).toBe('rgba(245, 250, 255, 0.96)');

    await act(async () => {
      tree.unmount();
    });
  });

  it('renders structured markdown-like AI content without leaking markdown markers', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <CoachStreamItem item={{ kind: 'internal_ai_private', status: 'confirmed', text: '### Tips\\n**Key takeaway:** Stay consistent.' }} />,
      );
    });

    const leakedNodes = tree.root.findAll((node) => {
      const value = node?.props?.children;
      return typeof value === 'string' && (value.includes('###') || value.includes('**'));
    });
    expect(leakedNodes).toHaveLength(0);

    await act(async () => {
      tree.unmount();
    });
  });

  it('keeps pending internal AI rows in plain text mode for streaming stability', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <CoachStreamItem item={{ kind: 'internal_ai_private', status: 'pending', text: '**Streaming** update' }} />,
      );
    });

    const pendingTextNode = tree.root.find(
      (node) => node.type === Text && node?.props?.children === '**Streaming** update',
    );
    expect(pendingTextNode).toBeTruthy();

    await act(async () => {
      tree.unmount();
    });
  });

  it('suppresses role labels when showRoleLabel is false', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <CoachStreamItem
          item={{ kind: 'trainer_input', text: 'Follow-up message' }}
          showRoleLabel={false}
        />,
      );
    });

    const labelNodes = tree.root.findAll((node) => node?.props?.children === 'Trainer');
    expect(labelNodes).toHaveLength(0);

    await act(async () => {
      tree.unmount();
    });
  });

  it('renders trainer slash commands as compact utility chips', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <CoachStreamItem item={{ kind: 'trainer_input', text: '/client' }} />,
      );
    });

    const commandTextNode = tree.root.find(
      (node) => node.type === Text && node?.props?.children === '/client',
    );
    expect(commandTextNode).toBeTruthy();

    const commandChipNode = tree.root.find(
      (node) => node?.props?.style && StyleSheet.flatten(node.props.style)?.maxWidth === '82%',
    );
    const commandChipStyle = StyleSheet.flatten(commandChipNode.props.style);
    expect(commandChipStyle?.borderRadius).toBeGreaterThan(100);
    expect(commandChipStyle?.borderWidth).toBe(1);

    await act(async () => {
      tree.unmount();
    });
  });
});

import React from 'react';
import renderer, { act } from 'react-test-renderer';

import AIResponseRenderer from '../AIResponseRenderer';
import { parseAIResponseText } from '../../utils/aiResponseParser';

describe('AIResponseRenderer', () => {
  it('renders option groups as separate option cards', async () => {
    const model = parseAIResponseText(
      [
        'Greek Yogurt Parfait: Plain Greek yogurt with berries.',
        'Tofu Scramble: Savory scramble with spinach.',
        'Protein Oatmeal: Oats with whey and chia.',
      ].join('\n'),
    );

    let tree;
    await act(async () => {
      tree = renderer.create(
        <AIResponseRenderer model={model} testIDPrefix="ai-test" />,
      );
    });

    expect(tree.root.findByProps({ testID: 'ai-test-root' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'ai-test-option-card-0' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'ai-test-option-card-1' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'ai-test-option-card-2' })).toBeTruthy();

    await act(async () => {
      tree.unmount();
    });
  });

  it('does not expose markdown markers in rendered text', async () => {
    const model = parseAIResponseText('### Protein Tips\n**Key takeaway:** Keep intensity moderate.');

    let tree;
    await act(async () => {
      tree = renderer.create(
        <AIResponseRenderer model={model} testIDPrefix="ai-test" />,
      );
    });

    const leakedMarkdownNodes = tree.root.findAll((node) => {
      const value = node?.props?.children;
      return typeof value === 'string' && (value.includes('**') || value.includes('###'));
    });

    expect(leakedMarkdownNodes).toHaveLength(0);

    await act(async () => {
      tree.unmount();
    });
  });

  it('renders numbered guidance as step rows', async () => {
    const model = parseAIResponseText('1. Warm up\n2. Main set\n3. Cool down');

    let tree;
    await act(async () => {
      tree = renderer.create(
        <AIResponseRenderer model={model} testIDPrefix="ai-test" />,
      );
    });

    expect(tree.root.findByProps({ testID: 'ai-test-step-0' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'ai-test-step-1' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'ai-test-step-2' })).toBeTruthy();

    await act(async () => {
      tree.unmount();
    });
  });

  it('supports optional image slots without blocking text rendering', async () => {
    const model = parseAIResponseText('Tofu Scramble: High-protein breakfast with spinach.');

    let tree;
    await act(async () => {
      tree = renderer.create(
        <AIResponseRenderer
          model={model}
          testIDPrefix="ai-test"
          imageResolver={() => 'https://example.com/image.jpg'}
        />,
      );
    });

    expect(tree.root.findByProps({ testID: 'ai-test-option-card-0' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'ai-test-image-0' })).toBeTruthy();

    await act(async () => {
      tree.unmount();
    });
  });

  it('renders clean paragraph fallback for unstructured text', async () => {
    const model = parseAIResponseText('This is one longer paragraph without explicit structure markers but still valid content for fallback rendering.');

    let tree;
    await act(async () => {
      tree = renderer.create(
        <AIResponseRenderer model={model} testIDPrefix="ai-test" />,
      );
    });

    expect(tree.root.findByProps({ testID: 'ai-test-block-0-type-paragraph' })).toBeTruthy();

    await act(async () => {
      tree.unmount();
    });
  });
});

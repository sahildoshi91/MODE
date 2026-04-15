import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { StyleSheet, View } from 'react-native';

import { InlineFeedback, ModeButton, ModeCard } from '../../../lib/components';
import { theme } from '../../../lib/theme';

function flatten(style) {
  return StyleSheet.flatten(style);
}

function createWithAct(element) {
  let tree;
  act(() => {
    tree = renderer.create(element);
  });
  return tree;
}

function unmountWithAct(tree) {
  act(() => {
    tree.unmount();
  });
}

function findButtonNode(tree) {
  return tree.root.find((node) => (
    node.props?.accessibilityRole === 'button'
      && typeof node.props?.style === 'function'
  ));
}

describe('Phase 3 primitive refactor', () => {
  it('supports non-breaking ModeButton sizes including sm', () => {
    const smTree = createWithAct(<ModeButton title="Small" size="sm" />);
    const mdTree = createWithAct(<ModeButton title="Medium" size="md" />);
    const lgTree = createWithAct(<ModeButton title="Large" size="lg" />);

    const smStyle = flatten(findButtonNode(smTree).props.style({ pressed: false }));
    const mdStyle = flatten(findButtonNode(mdTree).props.style({ pressed: false }));
    const lgStyle = flatten(findButtonNode(lgTree).props.style({ pressed: false }));

    expect(smStyle.minHeight).toBe(40);
    expect(mdStyle.minHeight).toBe(48);
    expect(lgStyle.minHeight).toBe(56);

    unmountWithAct(smTree);
    unmountWithAct(mdTree);
    unmountWithAct(lgTree);
  });

  it('applies pressed and disabled interaction states on ModeButton', () => {
    const interactiveTree = createWithAct(<ModeButton title="Tap" />);
    const interactivePressable = findButtonNode(interactiveTree);

    const normalStyle = flatten(interactivePressable.props.style({ pressed: false }));
    const pressedStyle = flatten(interactivePressable.props.style({ pressed: true }));

    expect(normalStyle.opacity).toBeUndefined();
    expect(pressedStyle.opacity).toBe(theme.interaction.pressedOpacity);
    expect(pressedStyle.transform).toEqual([{ scale: theme.interaction.pressedScale }]);

    const disabledTree = createWithAct(<ModeButton title="Disabled" disabled />);
    const disabledPressable = findButtonNode(disabledTree);
    const disabledStyle = flatten(disabledPressable.props.style({ pressed: true }));

    expect(disabledStyle.opacity).toBe(theme.interaction.disabledOpacity);

    unmountWithAct(interactiveTree);
    unmountWithAct(disabledTree);
  });

  it('maps ModeCard state variant to semantic state tokens', () => {
    const tree = createWithAct(<ModeCard variant="state" state="OVERDRIVE" />);
    const card = tree.root.findByType(View);
    const cardStyle = flatten(card.props.style);

    expect(cardStyle.backgroundColor).toBe(theme.colors.state.overdriveFill);
    expect(cardStyle.borderColor).toBe(theme.colors.state.overdriveBorder);

    unmountWithAct(tree);
  });

  it('maps InlineFeedback types to semantic feedback styles', () => {
    const expectations = [
      ['success', theme.colors.feedback.successBg, theme.colors.feedback.successBorder],
      ['warning', theme.colors.feedback.warningBg, theme.colors.feedback.warningBorder],
      ['error', theme.colors.feedback.errorBg, theme.colors.feedback.errorBorder],
      ['info', theme.colors.feedback.infoBg, theme.colors.feedback.infoBorder],
    ];

    expectations.forEach(([type, backgroundColor, borderColor]) => {
      const tree = createWithAct(<InlineFeedback type={type} message="Message" />);
      const container = tree.root.findByType(View);
      const containerStyle = flatten(container.props.style);

      expect(containerStyle.backgroundColor).toBe(backgroundColor);
      expect(containerStyle.borderColor).toBe(borderColor);

      unmountWithAct(tree);
    });
  });

  it('returns null when InlineFeedback message is empty', () => {
    const tree = createWithAct(<InlineFeedback type="info" message="" />);
    expect(tree.toJSON()).toBeNull();
    unmountWithAct(tree);
  });
});

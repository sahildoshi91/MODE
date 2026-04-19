import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { StyleSheet, Text, View } from 'react-native';

import {
  GlassInputBar,
  GlassPill,
  GlassSlider,
  GlassSurface,
  GlassToggle,
} from '../../../lib/components';
import { theme } from '../../../lib/theme';

function flatten(style) {
  return StyleSheet.flatten(style);
}

describe('Glass primitives', () => {
  it('maps GlassSurface active state to glass fill and border tokens', () => {
    let tree;
    act(() => {
      tree = renderer.create(
        <GlassSurface state="active" testID="surface">
          <Text>content</Text>
        </GlassSurface>,
      );
    });

    const candidates = tree.root.findAll((node) => node.type === View && node.props?.style);
    const shell = candidates.find((node) => {
      const style = flatten(node.props.style);
      return (
        style?.backgroundColor === theme.colors.glass.active
        && style?.borderColor === theme.colors.glass.borderActive
      );
    });
    expect(shell).toBeTruthy();

    act(() => tree.unmount());
  });

  it('uses a thin edge highlight and avoids thick top bands', () => {
    let tree;
    act(() => {
      tree = renderer.create(
        <GlassSurface state="default" testID="surface-thin-highlight">
          <Text>content</Text>
        </GlassSurface>,
      );
    });

    const layers = tree.root.findAll((node) => node.type === View && node.props?.style);
    const edgeHighlightLayers = layers.filter((node) => {
      const style = flatten(node.props.style);
      return style?.backgroundColor === theme.colors.glass.edgeHighlight;
    });
    expect(edgeHighlightLayers.length).toBeGreaterThan(0);
    edgeHighlightLayers.forEach((node) => {
      const style = flatten(node.props.style);
      expect(style?.height).toBeLessThanOrEqual(2);
    });

    const thickTopBands = layers.filter((node) => {
      const style = flatten(node.props.style);
      return style?.backgroundColor === theme.colors.glass.highlight && Number(style?.height || 0) >= 8;
    });
    expect(thickTopBands.length).toBe(0);

    act(() => tree.unmount());
  });

  it('does not render corner bloom by default on GlassSurface', () => {
    let tree;
    act(() => {
      tree = renderer.create(
        <GlassSurface state="default" testID="surface-no-corner-bloom">
          <Text>content</Text>
        </GlassSurface>,
      );
    });

    const layers = tree.root.findAll((node) => node.type === View && node.props?.style);
    const bloomLayers = layers.filter((node) => {
      const style = flatten(node.props.style);
      return style?.backgroundColor === theme.colors.glass.cornerHighlight;
    });
    expect(bloomLayers.length).toBe(0);

    act(() => tree.unmount());
  });

  it('renders GlassPill selected and disabled states', () => {
    let tree;
    act(() => {
      tree = renderer.create(
        <GlassPill
          label="Selected"
          selected
          disabled
          onPress={() => {}}
          testID="pill"
        />,
      );
    });

    const pillButton = tree.root.find((node) => node.props?.accessibilityRole === 'button');
    expect(pillButton.props.disabled).toBe(true);

    const selectedSurface = tree.root.find((node) => {
      if (!node.props?.style) {
        return false;
      }
      const style = flatten(node.props.style);
      return style?.backgroundColor === theme.colors.glass.elevated;
    });
    expect(selectedSurface).toBeTruthy();

    act(() => tree.unmount());
  });

  it('calls onValueChange when GlassToggle is pressed', () => {
    const onValueChange = jest.fn();
    let tree;
    act(() => {
      tree = renderer.create(
        <GlassToggle value={false} onValueChange={onValueChange} testID="toggle" />,
      );
    });

    const toggle = tree.root.find((node) => node.props?.accessibilityRole === 'switch');
    act(() => {
      toggle.props.onPress();
    });

    expect(onValueChange).toHaveBeenCalledWith(true);
    act(() => tree.unmount());
  });

  it('renders GlassSlider with normalized filled-track state', () => {
    let tree;
    act(() => {
      tree = renderer.create(
        <GlassSlider
          value={0.4}
          min={0}
          max={1}
          onChange={() => {}}
          onComplete={() => {}}
          testID="slider"
        />,
      );
    });

    tree.root.findByProps({ testID: 'slider' });
    const fill = tree.root.find((node) => {
      if (!node.props?.style) {
        return false;
      }
      const style = flatten(node.props.style);
      return style?.width === '40%';
    });
    expect(fill).toBeTruthy();

    act(() => tree.unmount());
  });

  it('disables send action in GlassInputBar when value is empty', () => {
    let tree;
    act(() => {
      tree = renderer.create(
        <View>
          <GlassInputBar value="" onChangeText={() => {}} onSend={() => {}} />
        </View>,
      );
    });

    const sendButton = tree.root.find((node) => (
      node.props?.accessibilityRole === 'button'
      && node.props?.accessibilityLabel === 'Send message'
    ));
    expect(sendButton.props.disabled).toBe(true);

    act(() => tree.unmount());
  });
});

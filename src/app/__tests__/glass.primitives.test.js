import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import {
  ChatBubbleAI,
  ChatBubbleUser,
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
  it('maps GlassSurface active state to glass fill and edge tint tokens without hard borders', () => {
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
    expect(flatten(shell.props.style)?.borderWidth).toBe(1);

    act(() => tree.unmount());
  });

  it('uses a diffused ambient highlight and avoids pinned top-edge lines', () => {
    let tree;
    act(() => {
      tree = renderer.create(
        <GlassSurface state="default" testID="surface-thin-highlight">
          <Text>content</Text>
        </GlassSurface>,
      );
    });

    const layers = tree.root.findAll((node) => node.props);
    const legacyEdgeCatchLights = layers.filter((node) => {
      const colors = node.props?.colors;
      return Array.isArray(colors)
        && colors.length === 2;
    });
    const legacyPinnedWhiteGradients = legacyEdgeCatchLights.filter((node) => {
      const colors = node.props?.colors || [];
      return colors[0] === 'rgba(255,255,255,0.9)' && colors[1] === 'rgba(255,255,255,0)';
    });
    expect(legacyPinnedWhiteGradients.length).toBe(0);

    const topEdgeLineClips = tree.root.findAll((node) => {
      if (node.type !== View || !node.props?.style) {
        return false;
      }
      const style = flatten(node.props.style);
      return style?.top === 0
        && style?.overflow === 'hidden'
        && typeof style?.height === 'number'
        && style.height <= 1;
    });
    expect(topEdgeLineClips.length).toBe(0);

    const ambientHighlightBands = tree.root.findAll((node) => {
      if (node.type !== View || !node.props?.style) {
        return false;
      }
      const style = flatten(node.props.style);
      return style?.left === 10 && style?.right === 10 && style?.top === 6 && style?.height === 56;
    });
    expect(ambientHighlightBands.length).toBeGreaterThan(0);

    const diffusedAmbientGradients = layers.filter((node) => {
      const colors = node.props?.colors;
      return Array.isArray(colors)
        && colors.length === 3
        && colors[0] === 'rgba(255, 255, 255, 0)'
        && colors[2] === 'rgba(255, 255, 255, 0)';
    });
    expect(diffusedAmbientGradients.length).toBeGreaterThan(0);

    diffusedAmbientGradients.forEach((node) => {
      const style = flatten(node.props.style);
      if (typeof style?.height === 'number') {
        expect(style.height).toBeGreaterThanOrEqual(40);
      }
    });

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
      return style?.backgroundColor === theme.colors.nav.activeBg;
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

  it('applies differentiated chat bubble contrast tokens and width rhythm', () => {
    let tree;
    act(() => {
      tree = renderer.create(
        <View>
          <ChatBubbleAI text="AI bubble text" showSpeakerLabel={false} />
          <ChatBubbleUser text="User bubble text" showSpeakerLabel={false} />
        </View>,
      );
    });

    const candidates = tree.root.findAll((node) => node.type === View && node.props?.style);
    const aiShell = candidates.find((node) => {
      const style = flatten(node.props.style);
      return (
        style?.backgroundColor === 'rgba(14, 25, 44, 0.64)'
        && style?.borderColor === 'rgba(214, 230, 255, 0.28)'
      );
    });
    const userShell = candidates.find((node) => {
      const style = flatten(node.props.style);
      return (
        style?.backgroundColor === 'rgba(95, 145, 236, 0.38)'
        && style?.borderColor === 'rgba(152, 196, 255, 0.50)'
      );
    });
    expect(aiShell).toBeTruthy();
    expect(userShell).toBeTruthy();
    expect(flatten(aiShell.props.style)?.borderWidth).toBe(1);
    expect(flatten(userShell.props.style)?.borderWidth).toBe(1);
    expect(flatten(aiShell.props.style)?.maxWidth).toBe('74%');
    expect(flatten(userShell.props.style)?.maxWidth).toBe('74%');

    const aiText = tree.root.find((node) => node.type === Text && node.props?.children === 'AI bubble text');
    const userText = tree.root.find((node) => node.type === Text && node.props?.children === 'User bubble text');
    expect(flatten(aiText.props.style)?.color).toBe('rgba(255, 255, 255, 0.94)');
    expect(flatten(userText.props.style)?.color).toBe('rgba(255, 255, 255, 0.95)');

    act(() => tree.unmount());
  });

  it('applies grouped chat bubble corner chaining and padding rhythm', () => {
    let tree;
    act(() => {
      tree = renderer.create(
        <View>
          <ChatBubbleAI text="AI grouped" showSpeakerLabel={false} groupPosition="middle" />
          <ChatBubbleUser text="User grouped" showSpeakerLabel={false} groupPosition="middle" />
        </View>,
      );
    });

    const candidates = tree.root.findAll((node) => node.type === View && node.props?.style);
    const aiGroupedContent = candidates.find((node) => {
      const style = flatten(node.props.style);
      return (
        style?.paddingHorizontal === 14
        && style?.paddingVertical === 10
        && style?.borderTopLeftRadius === 10
        && style?.borderTopRightRadius === 16
        && style?.borderBottomLeftRadius === 10
        && style?.borderBottomRightRadius === 16
      );
    });
    const userGroupedContent = candidates.find((node) => {
      const style = flatten(node.props.style);
      return (
        style?.paddingHorizontal === 14
        && style?.paddingVertical === 10
        && style?.borderTopLeftRadius === 16
        && style?.borderTopRightRadius === 10
        && style?.borderBottomLeftRadius === 16
        && style?.borderBottomRightRadius === 10
      );
    });
    expect(aiGroupedContent).toBeTruthy();
    expect(userGroupedContent).toBeTruthy();

    act(() => tree.unmount());
  });

  it('supports custom renderContent in ChatBubbleAI without breaking default bubbles', () => {
    let tree;
    act(() => {
      tree = renderer.create(
        <View>
          <ChatBubbleAI
            text="AI bubble text"
            showSpeakerLabel={false}
            renderContent={() => (
              <View testID="ai-rich-content">
                <Text>Structured response</Text>
              </View>
            )}
          />
          <ChatBubbleAI text="Default bubble text" showSpeakerLabel={false} />
        </View>,
      );
    });

    expect(tree.root.findByProps({ testID: 'ai-rich-content' })).toBeTruthy();
    const defaultTextNode = tree.root.find(
      (node) => node.type === Text && node.props?.children === 'Default bubble text',
    );
    expect(defaultTextNode).toBeTruthy();

    act(() => tree.unmount());
  });

  it('uses high-contrast text and placeholder styling in GlassInputBar', () => {
    let tree;
    act(() => {
      tree = renderer.create(
        <View>
          <GlassInputBar
            value="Need a training adjustment"
            onChangeText={() => {}}
            onSend={() => {}}
            placeholder="Tell your coach what you need..."
          />
        </View>,
      );
    });

    const input = tree.root.findByType(TextInput);
    expect(input.props.placeholderTextColor).toBe('rgba(232, 243, 255, 0.76)');
    expect(flatten(input.props.style)?.color).toBe('rgba(255, 255, 255, 0.96)');
    const sendButton = tree.root.find((node) => (
      node.props?.accessibilityRole === 'button'
      && node.props?.accessibilityLabel === 'Send message'
    ));
    const sendButtonStyle = flatten(sendButton.props.style({ pressed: false }));
    expect(sendButtonStyle?.borderWidth).toBeUndefined();

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

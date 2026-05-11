import React, { useMemo, useState } from 'react';
import {
  Image,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ModeText } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import {
  AI_BLOCK_TYPES,
  isRenderableStructuredModel,
} from '../rendering/model';

function resolveSpanKey(prefix, index) {
  return `${prefix}-span-${index}`;
}

function InlineText({
  inlines,
  variant = 'bodySm',
  tone = 'primary',
  style,
  testID,
}) {
  const safeInlines = Array.isArray(inlines) ? inlines : [];

  if (safeInlines.length === 0) {
    return null;
  }

  return (
    <ModeText variant={variant} tone={tone} style={style} testID={testID}>
      {safeInlines.map((span, index) => (
        <Text
          key={resolveSpanKey(testID || 'inline', index)}
          style={span?.strong ? styles.inlineStrong : undefined}
        >
          {span?.text || ''}
        </Text>
      ))}
    </ModeText>
  );
}

export function AIResponseImageHeader({
  uri,
  testID,
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const safeUri = typeof uri === 'string' && uri.trim().length > 0 ? uri.trim() : null;

  if (!safeUri || imageFailed) {
    return null;
  }

  return (
    <Image
      testID={testID}
      source={{ uri: safeUri }}
      style={styles.imageHeader}
      onError={() => setImageFailed(true)}
      resizeMode="cover"
    />
  );
}

export function AIResponseMetadataRow({
  metadata,
  testID,
}) {
  const items = Array.isArray(metadata) ? metadata.filter((item) => item?.label && item?.value) : [];
  if (items.length === 0) {
    return null;
  }

  return (
    <View style={styles.metadataRow} testID={testID}>
      {items.map((item, index) => (
        <ModeText key={`${item.label}-${index}`} variant="caption" tone="tertiary" style={styles.metadataText}>
          {`${item.label}: ${item.value}`}
        </ModeText>
      ))}
    </View>
  );
}

function resolveCardImageUri({ item, imageResolver = null }) {
  if (!item || typeof item !== 'object') {
    return null;
  }
  if (typeof item.image_uri === 'string' && item.image_uri.trim().length > 0) {
    return item.image_uri.trim();
  }
  if (typeof imageResolver === 'function') {
    return imageResolver(item.imageHint || null);
  }
  return null;
}

function AIResponseCard({
  item,
  imageResolver = null,
  testIDPrefix,
  cardIndex,
}) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const imageUri = resolveCardImageUri({ item, imageResolver });
  const optionCardTestID = `${testIDPrefix}-option-card-${cardIndex}`;

  return (
    <View style={styles.optionCard} testID={optionCardTestID}>
      <AIResponseImageHeader
        uri={imageUri}
        testID={`${testIDPrefix}-image-${cardIndex}`}
      />
      <InlineText
        inlines={item.title}
        variant="label"
        tone="primary"
        style={styles.optionTitle}
      />
      <InlineText
        inlines={item.body}
        variant="bodySm"
        tone="secondary"
        style={styles.optionBody}
      />
      <AIResponseMetadataRow
        metadata={item.meta}
        testID={`${testIDPrefix}-metadata-${cardIndex}`}
      />
    </View>
  );
}

export function AIResponseOptionList({
  items,
  imageResolver = null,
  testIDPrefix,
}) {
  const safeItems = Array.isArray(items) ? items : [];
  if (safeItems.length === 0) {
    return null;
  }

  return (
    <View style={styles.optionGroup}>
      {safeItems.map((item, index) => (
        <AIResponseCard
          key={`option-${index}`}
          item={item}
          imageResolver={imageResolver}
          testIDPrefix={testIDPrefix}
          cardIndex={index}
        />
      ))}
    </View>
  );
}

export function AIResponseStepList({
  items,
  testIDPrefix,
}) {
  const safeItems = Array.isArray(items) ? items : [];
  if (safeItems.length === 0) {
    return null;
  }

  return (
    <View style={styles.stepList}>
      {safeItems.map((item, index) => (
        <View key={`step-${index}`} style={styles.stepRow} testID={`${testIDPrefix}-step-${index}`}>
          <View style={styles.stepBadge}>
            <ModeText variant="caption" tone="accent" style={styles.stepBadgeText}>
              {String(item?.step || index + 1)}
            </ModeText>
          </View>
          <InlineText
            inlines={item?.inlines}
            variant="bodySm"
            tone="primary"
            style={styles.stepText}
          />
        </View>
      ))}
    </View>
  );
}

function AIResponseBulletList({
  items,
  testIDPrefix,
}) {
  const safeItems = Array.isArray(items) ? items : [];
  if (safeItems.length === 0) {
    return null;
  }

  return (
    <View style={styles.bulletList}>
      {safeItems.map((item, index) => (
        <View key={`bullet-${index}`} style={styles.bulletRow}>
          <View style={styles.bulletDot} />
          <InlineText
            inlines={item}
            variant="bodySm"
            tone="secondary"
            style={styles.bulletText}
            testID={`${testIDPrefix}-bullet-${index}`}
          />
        </View>
      ))}
    </View>
  );
}

function AIResponseParagraph({
  inlines,
  testID,
}) {
  return (
    <InlineText
      inlines={inlines}
      variant="bodySm"
      tone="primary"
      style={styles.paragraphText}
      testID={testID}
    />
  );
}

export function AIResponseSection({
  block,
  imageResolver = null,
  testIDPrefix,
  depth = 0,
}) {
  if (!block || block.type !== AI_BLOCK_TYPES.SECTION) {
    return null;
  }

  const children = Array.isArray(block.children) ? block.children : [];

  return (
    <View style={[styles.sectionBlock, depth > 0 && styles.sectionNested]}>
      <InlineText
        inlines={block.title}
        variant="label"
        tone="tertiary"
        style={styles.sectionTitle}
        testID={`${testIDPrefix}-section-title-${block.id}`}
      />
      <View style={styles.sectionChildren}>
        {children.map((child, index) => (
          <AIResponseBlock
            key={child?.id || `section-child-${index}`}
            block={child}
            imageResolver={imageResolver}
            testIDPrefix={testIDPrefix}
            index={index}
            depth={depth + 1}
          />
        ))}
      </View>
    </View>
  );
}

function AIResponseBlock({
  block,
  imageResolver = null,
  testIDPrefix,
  index = 0,
  depth = 0,
}) {
  if (!block || typeof block !== 'object') {
    return null;
  }

  const blockTestID = `${testIDPrefix}-block-${index}`;

  if (block.type === AI_BLOCK_TYPES.PARAGRAPH) {
    return (
      <View style={styles.blockWrap} testID={`${blockTestID}-type-paragraph`}>
        <AIResponseParagraph
          inlines={block.inlines}
          testID={`${testIDPrefix}-paragraph-${index}`}
        />
      </View>
    );
  }

  if (block.type === AI_BLOCK_TYPES.SECTION) {
    return (
      <View style={styles.blockWrap} testID={`${blockTestID}-type-section`}>
        <AIResponseSection
          block={block}
          imageResolver={imageResolver}
          testIDPrefix={testIDPrefix}
          depth={depth}
        />
      </View>
    );
  }

  if (block.type === AI_BLOCK_TYPES.STEP_LIST) {
    return (
      <View style={styles.blockWrap} testID={`${blockTestID}-type-steps`}>
        <AIResponseStepList items={block.items} testIDPrefix={testIDPrefix} />
      </View>
    );
  }

  if (block.type === AI_BLOCK_TYPES.BULLET_LIST) {
    return (
      <View style={styles.blockWrap} testID={`${blockTestID}-type-list`}>
        <AIResponseBulletList items={block.items} testIDPrefix={testIDPrefix} />
      </View>
    );
  }

  if (block.type === AI_BLOCK_TYPES.OPTION_GROUP) {
    return (
      <View style={styles.blockWrap} testID={`${blockTestID}-type-option-group`}>
        <AIResponseOptionList
          items={block.items}
          imageResolver={imageResolver}
          testIDPrefix={testIDPrefix}
        />
      </View>
    );
  }

  if (block.type === AI_BLOCK_TYPES.OPTION_CARD) {
    return (
      <View style={styles.blockWrap} testID={`${blockTestID}-type-option-card`}>
        <AIResponseCard
          item={block.item}
          imageResolver={imageResolver}
          testIDPrefix={testIDPrefix}
          cardIndex={index}
        />
      </View>
    );
  }

  return null;
}

export default function AIResponseRenderer({
  model,
  imageResolver = null,
  testIDPrefix = 'ai-response',
}) {
  const blocks = useMemo(() => (
    isRenderableStructuredModel(model) ? model.blocks : []
  ), [model]);

  if (!Array.isArray(blocks) || blocks.length === 0) {
    return null;
  }

  return (
    <View style={styles.root} testID={`${testIDPrefix}-root`}>
      {blocks.map((block, index) => (
        <AIResponseBlock
          key={block?.id || `block-${index}`}
          block={block}
          imageResolver={imageResolver}
          testIDPrefix={testIDPrefix}
          index={index}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: 8,
  },
  blockWrap: {
    width: '100%',
  },
  inlineStrong: {
    fontWeight: '600',
  },
  paragraphText: {
    lineHeight: theme.typography.body2.lineHeight,
  },
  sectionBlock: {
    gap: 6,
  },
  sectionNested: {
    marginTop: 2,
  },
  sectionTitle: {
    textTransform: 'uppercase',
    letterSpacing: 0.35,
  },
  sectionChildren: {
    gap: 8,
  },
  optionGroup: {
    gap: 8,
  },
  optionCard: {
    borderRadius: theme.radii.s,
    borderWidth: 1,
    borderColor: theme.colors.glass.borderSoft,
    backgroundColor: theme.colors.glass.base,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    gap: 6,
  },
  optionTitle: {
    fontWeight: '600',
  },
  optionBody: {
    lineHeight: theme.typography.body2.lineHeight,
  },
  metadataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  metadataText: {
    fontWeight: '500',
  },
  imageHeader: {
    width: '100%',
    height: 120,
    borderRadius: theme.radii.s,
    backgroundColor: theme.colors.surface.elevated,
    marginBottom: 2,
  },
  stepList: {
    gap: 8,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderRadius: theme.radii.s,
    borderWidth: 1,
    borderColor: theme.colors.glass.borderSoft,
    backgroundColor: theme.colors.glass.base,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1] + 2,
  },
  stepBadge: {
    minWidth: 24,
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    borderColor: theme.colors.accent.primary,
    backgroundColor: theme.colors.accent.soft,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBadgeText: {
    fontWeight: '700',
  },
  stepText: {
    flex: 1,
    lineHeight: theme.typography.body2.lineHeight,
  },
  bulletList: {
    gap: 6,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  bulletDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 7,
    backgroundColor: theme.colors.text.tertiary,
  },
  bulletText: {
    flex: 1,
    lineHeight: theme.typography.body2.lineHeight,
  },
});

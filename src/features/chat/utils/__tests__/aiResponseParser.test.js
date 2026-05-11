import { parseAIResponseText, sanitizeAssistantDisplayText } from '../aiResponseParser';
import { AI_BLOCK_TYPES } from '../../rendering/model';

function collectInlineText(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectInlineText(item));
  }
  if (typeof value === 'object') {
    const output = [];
    if (typeof value.text === 'string') {
      output.push(value.text);
    }
    return output.concat(...Object.values(value).map((item) => collectInlineText(item)));
  }
  return [];
}

describe('parseAIResponseText', () => {
  it('parses recommendation groups into option cards', () => {
    const model = parseAIResponseText(
      [
        '**Greek Yogurt Parfait:** Plain Greek yogurt with berries.',
        '**Tofu Scramble:** Crumbled tofu with spinach and spices.',
        '**Protein Oatmeal:** Oats with whey and chia seeds.',
      ].join('\n'),
    );

    expect(model.blocks[0].type).toBe(AI_BLOCK_TYPES.OPTION_GROUP);
    expect(model.blocks[0].items).toHaveLength(3);

    const flattenedText = collectInlineText(model.blocks).join(' ');
    expect(flattenedText).not.toContain('**');
  });

  it('parses a single high-confidence recommendation line into option_card', () => {
    const model = parseAIResponseText('Tofu Scramble: High-protein breakfast with spinach.');
    expect(model.blocks[0].type).toBe(AI_BLOCK_TYPES.OPTION_CARD);
  });

  it('parses numbered guidance into a step_list', () => {
    const model = parseAIResponseText('1. Warm up\n2. Main set\n3. Cool down');
    expect(model.blocks[0].type).toBe(AI_BLOCK_TYPES.STEP_LIST);
    expect(model.blocks[0].items).toHaveLength(3);
    const firstStepText = collectInlineText(model.blocks[0].items[0].inlines).join('');
    expect(firstStepText).not.toMatch(/^1\./);
  });

  it('parses headings into section blocks with children', () => {
    const model = parseAIResponseText('### Protein Tips\nAim for 30g each meal.\n\n- Breakfast\n- Lunch');
    expect(model.blocks[0].type).toBe(AI_BLOCK_TYPES.SECTION);
    expect(model.blocks[0].children.some((child) => child.type === AI_BLOCK_TYPES.PARAGRAPH)).toBe(true);
    expect(model.blocks[0].children.some((child) => child.type === AI_BLOCK_TYPES.BULLET_LIST)).toBe(true);
  });

  it('converts bold label markdown into strong inline spans', () => {
    const model = parseAIResponseText('**Key takeaway:** Keep intensity moderate.');
    expect(model.blocks[0].type).toBe(AI_BLOCK_TYPES.PARAGRAPH);
    const strongSpans = model.blocks[0].inlines.filter((span) => span?.strong);
    expect(strongSpans.length).toBeGreaterThan(0);
    expect(strongSpans[0].text).toContain('Key takeaway:');
  });

  it('handles unmatched strong markers gracefully without leaking markdown', () => {
    const model = parseAIResponseText('Use **progressive overload for 4 weeks');
    const flattenedText = collectInlineText(model.blocks).join(' ');
    expect(flattenedText).not.toContain('**');
    expect(model.blocks[0].type).toBe(AI_BLOCK_TYPES.PARAGRAPH);
  });

  it('keeps ambiguous single colon lines as paragraphs', () => {
    const model = parseAIResponseText('Today: we keep training simple and consistent.');
    expect(model.blocks[0].type).toBe(AI_BLOCK_TYPES.PARAGRAPH);
  });

  it('keeps non-list numeric prose as a paragraph', () => {
    const model = parseAIResponseText('In 2026, consistency still wins.');
    expect(model.blocks[0].type).toBe(AI_BLOCK_TYPES.PARAGRAPH);
  });

  it('normalizes windows newlines', () => {
    const model = parseAIResponseText('1. Warm up\r\n2. Main set\r\n3. Cool down');
    expect(model.blocks[0].type).toBe(AI_BLOCK_TYPES.STEP_LIST);
  });

  it('preserves mixed structure ordering', () => {
    const model = parseAIResponseText(
      [
        '### Plan',
        'Greek Yogurt Parfait: Base option with berries.',
        'Tofu Scramble: Savory option with peppers.',
        '',
        '1. Warm up',
        '2. Main set',
      ].join('\n'),
    );
    expect(model.blocks[0].type).toBe(AI_BLOCK_TYPES.SECTION);
    const sectionChildrenTypes = model.blocks[0].children.map((child) => child.type);
    expect(sectionChildrenTypes).toContain(AI_BLOCK_TYPES.OPTION_GROUP);
    expect(sectionChildrenTypes).toContain(AI_BLOCK_TYPES.STEP_LIST);
  });

  it('returns empty blocks for whitespace input', () => {
    const model = parseAIResponseText('\n\n   \n');
    expect(model.blocks).toHaveLength(0);
  });

  it('strips emoji from rendered text spans', () => {
    const model = parseAIResponseText('Keep going 🔥 stay consistent ✅');
    const flattenedText = collectInlineText(model.blocks).join(' ');
    expect(flattenedText).not.toContain('🔥');
    expect(flattenedText).not.toContain('✅');
  });

  it('removes fenced trailing internal metadata from rendered assistant text', () => {
    const model = parseAIResponseText(
      [
        '10. **Calf Stretch (Wall):** Stand facing a wall and keep your heel down.',
        '',
        'Take your time and do not push into pain.',
        '',
        '```json',
        '{"task_type":"stretching"}',
        '```',
      ].join('\n'),
    );

    const flattenedText = collectInlineText(model.blocks).join(' ');
    expect(flattenedText).toContain('Calf Stretch');
    expect(flattenedText).not.toContain('task_type');
    expect(flattenedText).not.toMatch(/\bjson\b/i);
  });

  it('removes bare json-labeled trailing internal metadata', () => {
    const text = sanitizeAssistantDisplayText(
      'Let me know how you feel after running through these!\njson {"task_type":"stretching"}',
    );

    expect(text).toBe('Let me know how you feel after running through these!');
  });

  it('removes bare trailing internal metadata objects', () => {
    const text = sanitizeAssistantDisplayText(
      'Let me know how you feel after running through these!\n{"task_type":"stretching"}',
    );

    expect(text).toBe('Let me know how you feel after running through these!');
  });

  it('preserves user-facing json without internal metadata keys', () => {
    const rawText = 'Use this JSON:\n{"exercise":"calf stretch","duration":"30s"}';

    expect(sanitizeAssistantDisplayText(rawText)).toBe(rawText);
  });

  it('supports indented continuation lines for option bodies', () => {
    const model = parseAIResponseText('Greek Yogurt Parfait: Base description\n  add chia + cinnamon');
    expect(model.blocks[0].type).toBe(AI_BLOCK_TYPES.OPTION_CARD);
    const bodyText = collectInlineText(model.blocks[0].item.body).join('');
    expect(bodyText).toContain('add chia + cinnamon');
  });
});

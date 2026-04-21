import { generateKnowledgeNoteTitle } from '../knowledgeNoteTitleSummary';

describe('generateKnowledgeNoteTitle', () => {
  it('produces a compact <=4-word summary for normal note text', () => {
    const title = generateKnowledgeNoteTitle(
      'If stress is high, lower intensity before changing training frequency.',
    );

    expect(title.split(/\s+/).length).toBeLessThanOrEqual(4);
    expect(title).toBe('Stress High Lower Intensity');
  });

  it('normalizes punctuation and extra whitespace', () => {
    const title = generateKnowledgeNoteTitle(
      '   Build!!!   consistency,\n  then progress overload safely.  ',
    );

    expect(title).toBe('Build Consistency Progress Overload');
  });

  it('falls back safely when input is sparse', () => {
    expect(generateKnowledgeNoteTitle('')).toBe('Coach Note');
    expect(generateKnowledgeNoteTitle('mobility')).toBe('Mobility Note');
  });
});


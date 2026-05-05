import { parseClientCoachMemoryIntent } from '../clientCoachMemoryIntent';

describe('clientCoachMemoryIntent', () => {
  it('extracts the fact from explicit remember language', () => {
    expect(parseClientCoachMemoryIntent('Can you remember that I hate burpees?'))
      .toEqual(expect.objectContaining({
        text: 'I hate burpees',
        memoryType: 'preference',
        category: 'coach-chat',
        tags: ['coach-chat', 'preference'],
        aiUsable: true,
      }));

    expect(parseClientCoachMemoryIntent('Can you remember that i\u2019m trying to get a six pack'))
      .toEqual(expect.objectContaining({
        text: 'i\u2019m trying to get a six pack',
        memoryType: 'note',
        category: 'coach-chat',
        tags: ['coach-chat', 'note'],
        aiUsable: true,
      }));
  });

  it('extracts slash command and save-to-memory payloads', () => {
    expect(parseClientCoachMemoryIntent('/mem I prefer morning workouts'))
      .toEqual(expect.objectContaining({
        text: 'I prefer morning workouts',
        memoryType: 'preference',
      }));

    expect(parseClientCoachMemoryIntent('save to memory: my left knee gets sore after lunges.'))
      .toEqual(expect.objectContaining({
        text: 'my left knee gets sore after lunges',
        memoryType: 'constraint',
      }));
  });

  it('ignores negated and empty memory requests', () => {
    expect(parseClientCoachMemoryIntent("don't remember that I hate burpees")).toBeNull();
    expect(parseClientCoachMemoryIntent('do not save my knee pain')).toBeNull();
    expect(parseClientCoachMemoryIntent('can you remember this?')).toBeNull();
    expect(parseClientCoachMemoryIntent('can you remember or save to your memory')).toBeNull();
  });

  it('classifies constraints and notes without using AI', () => {
    expect(parseClientCoachMemoryIntent('remember that I cannot train late at night'))
      .toEqual(expect.objectContaining({
        text: 'I cannot train late at night',
        memoryType: 'constraint',
      }));

    expect(parseClientCoachMemoryIntent('please remember that my work trip is next Thursday'))
      .toEqual(expect.objectContaining({
        text: 'my work trip is next Thursday',
        memoryType: 'note',
      }));
  });
});

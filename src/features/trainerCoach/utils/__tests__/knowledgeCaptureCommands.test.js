import { parseKnowledgeCaptureCommand } from '../knowledgeCaptureCommands';

describe('knowledgeCaptureCommands', () => {
  it('parses supported capture commands with payload', () => {
    expect(parseKnowledgeCaptureCommand('/note Keep protein high')).toEqual(expect.objectContaining({
      kind: 'capture',
      command: '/note',
      payload: 'Keep protein high',
      type: 'note',
      scope: 'global',
    }));

    expect(parseKnowledgeCaptureCommand('/clientnote Use lower RPE on poor sleep')).toEqual(expect.objectContaining({
      kind: 'capture',
      command: '/clientnote',
      payload: 'Use lower RPE on poor sleep',
      type: 'note',
      scope: 'client',
    }));

    expect(parseKnowledgeCaptureCommand('/rule Keep cues short')).toEqual(expect.objectContaining({
      kind: 'capture',
      command: '/rule',
      type: 'rule',
      scope: 'global',
    }));

    expect(parseKnowledgeCaptureCommand('/faq What is deload week?')).toEqual(expect.objectContaining({
      kind: 'capture',
      command: '/faq',
      type: 'faq',
    }));
  });

  it('treats escaped capture commands as plain text sends', () => {
    expect(parseKnowledgeCaptureCommand('\\/note send literally')).toEqual({
      kind: 'escaped_capture',
      raw: '\\/note send literally',
      text: '/note send literally',
    });
  });

  it('ignores non-capture or unknown slash input', () => {
    expect(parseKnowledgeCaptureCommand('/client')).toEqual(expect.objectContaining({ kind: 'none' }));
    expect(parseKnowledgeCaptureCommand('hello')).toEqual(expect.objectContaining({ kind: 'none' }));
  });
});

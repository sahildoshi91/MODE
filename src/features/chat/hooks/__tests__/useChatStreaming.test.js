import {
  CHAT_STREAM_EVENT_TYPES,
  normalizeChatStreamEvent,
} from '../useChatStreaming';

describe('normalizeChatStreamEvent', () => {
  it('normalizes canonical token events as message deltas', () => {
    const event = normalizeChatStreamEvent({ type: 'token', content: 'Hey ' });

    expect(event.type).toBe(CHAT_STREAM_EVENT_TYPES.MESSAGE_DELTA);
    expect(event.delta).toBe('Hey ');
  });

  it('ignores backend legacy aliases after canonical token support', () => {
    const event = normalizeChatStreamEvent({
      type: 'message_delta',
      delta: 'Hey ',
      legacy_alias: true,
      legacy_alias_for_seq: 1,
    });

    expect(event.type).toBe(CHAT_STREAM_EVENT_TYPES.LEGACY_ALIAS);
    expect(event.delta).toBe('Hey ');
  });

  it('keeps old non-alias message deltas compatible', () => {
    const event = normalizeChatStreamEvent({ type: 'message_delta', delta: 'old' });

    expect(event.type).toBe(CHAT_STREAM_EVENT_TYPES.MESSAGE_DELTA);
    expect(event.delta).toBe('old');
  });
});


function randomSuffix() {
  return Math.random().toString(16).slice(2, 10);
}

function randomHex(length) {
  let out = '';
  while (out.length < length) {
    out += Math.random().toString(16).slice(2);
  }
  return out.slice(0, length);
}

function buildUuidLike() {
  const timeSeed = Date.now().toString(16).padStart(12, '0').slice(-12);
  const segmentA = randomHex(8);
  const segmentB = randomHex(4);
  const segmentC = `4${randomHex(3)}`;
  const variantNibble = (8 + Math.floor(Math.random() * 4)).toString(16);
  const segmentD = `${variantNibble}${randomHex(3)}`;
  const segmentE = `${timeSeed}${randomHex(0)}`;
  return `${segmentA}-${segmentB}-${segmentC}-${segmentD}-${segmentE}`;
}

export function buildClientMessageId(prefix = 'client-msg') {
  return `${prefix}-${Date.now()}-${randomSuffix()}`;
}

export function buildIdempotencyKey(prefix = 'mode-chat') {
  return `${prefix}-${Date.now()}-${randomSuffix()}`;
}

export function buildRequestId(prefix = 'req') {
  if (prefix === 'uuid' || prefix === 'request') {
    return buildUuidLike();
  }
  return buildUuidLike();
}

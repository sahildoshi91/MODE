const COMPACT_HEIGHT_THRESHOLD = 700;
const ORB_WIDTH_RATIO = 0.5;
const ORB_MIN_SIZE = 176;
const ORB_MAX_SIZE = 248;
const ORB_ANCHOR_RATIO_COMPACT = 0.42;
const ORB_ANCHOR_RATIO_REGULAR = 0.44;
const SUBTITLE_GAP_COMPACT = 24;
const SUBTITLE_GAP_REGULAR = 28;
const HORIZONTAL_PADDING = 28;
const SUBTITLE_MAX_WIDTH = 320;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function coerceNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getBreathingLayout({ width, height, insets } = {}) {
  const resolvedWidth = Math.max(0, coerceNumber(width, 390));
  const resolvedHeight = Math.max(0, coerceNumber(height, 844));
  const safeTop = Math.max(0, coerceNumber(insets?.top, 0));
  const safeBottom = Math.max(0, coerceNumber(insets?.bottom, 0));

  const availableHeight = Math.max(0, resolvedHeight - safeTop - safeBottom);
  const compact = availableHeight <= COMPACT_HEIGHT_THRESHOLD;
  const anchorRatio = compact ? ORB_ANCHOR_RATIO_COMPACT : ORB_ANCHOR_RATIO_REGULAR;

  const orbDiameter = clamp(
    Math.round(resolvedWidth * ORB_WIDTH_RATIO),
    ORB_MIN_SIZE,
    ORB_MAX_SIZE,
  );
  const orbRadius = orbDiameter / 2;
  const orbCenterY = safeTop + (availableHeight * anchorRatio);
  const orbTopOffset = Math.max(0, orbCenterY - orbRadius);
  const subtitleGap = compact ? SUBTITLE_GAP_COMPACT : SUBTITLE_GAP_REGULAR;
  const subtitleMaxWidth = Math.min(Math.max(0, resolvedWidth - (HORIZONTAL_PADDING * 2)), SUBTITLE_MAX_WIDTH);

  return {
    compact,
    orbDiameter,
    orbRadius,
    orbCenterY,
    orbTopOffset,
    subtitleGap,
    horizontalPadding: HORIZONTAL_PADDING,
    subtitleMaxWidth,
  };
}

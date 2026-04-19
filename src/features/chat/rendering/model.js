export const AI_RESPONSE_MODEL_VERSION = 1;

export const AI_BLOCK_TYPES = {
  SECTION: 'section',
  PARAGRAPH: 'paragraph',
  BULLET_LIST: 'bullet_list',
  STEP_LIST: 'step_list',
  OPTION_GROUP: 'option_group',
  OPTION_CARD: 'option_card',
};

export const IMAGE_HINT_TYPES = {
  NUTRITION: 'nutrition',
  WORKOUT: 'workout',
  EXERCISE: 'exercise',
};

export function createEmptyAIResponseModel(rawText = '') {
  return {
    version: AI_RESPONSE_MODEL_VERSION,
    rawText,
    blocks: [],
    hasStructure: false,
    mediaEligibility: 'none',
  };
}

export function isRenderableStructuredModel(model) {
  return Boolean(
    model
      && typeof model === 'object'
      && Array.isArray(model.blocks)
      && model.blocks.length > 0,
  );
}

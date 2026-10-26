const TEXT_FIELDS = ['action', 'objective', 'obstacle', 'result', 'productionNotes', 'shotPlan', 'soundDesign'];
const DIALOGUE_FIELDS = ['character', 'line', 'delivery', 'physicalAction', 'position', 'subtext'];

function invalid(message) {
  const error = new Error(message);
  error.status = 400;
  throw error;
}

// Keep the comparison independent of MongoDB field ordering and schema defaults.
function sceneEditSnapshot(scene) {
  if (!scene || typeof scene !== 'object' || Array.isArray(scene)) return null;
  const result = Object.fromEntries(TEXT_FIELDS.map(field => [field, String(scene[field] ?? '')]));
  result.dialogue = Array.from(scene.dialogue || [], line => Object.fromEntries(DIALOGUE_FIELDS.map(field => [field, String(line?.[field] ?? '')])));
  return result;
}

function validateSceneEdit(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('请提供要保存的场景正文');
  const text = (value, limit) => {
    if (typeof value !== 'string' || value.length > limit) invalid('场景字段格式无效或文字过长');
    return value; // Preserve the author's whitespace and wording without any AI postprocessing.
  };
  const result = Object.fromEntries(TEXT_FIELDS.map(field => [field, text(input[field] ?? '', 100000)]));
  if (!Array.isArray(input.dialogue) || input.dialogue.length > 1000) invalid('对白列表格式无效或条数过多');
  result.dialogue = input.dialogue.map(line => {
    if (!line || typeof line !== 'object' || Array.isArray(line)) invalid('对白格式无效');
    return Object.fromEntries(DIALOGUE_FIELDS.map(field => [field, text(line[field] ?? '', field === 'line' ? 20000 : 5000)]));
  });
  if (!result.action.trim() && !result.dialogue.some(line => line.line.trim())) invalid('请保留动作描写或至少一句对白');
  return result;
}

module.exports = { sceneEditSnapshot, validateSceneEdit };

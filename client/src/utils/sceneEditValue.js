export function createSceneEditValue(scene) {
  const fields = ['action', 'objective', 'obstacle', 'result', 'productionNotes', 'shotPlan', 'soundDesign']
  const dialogueFields = ['character', 'line', 'delivery', 'physicalAction', 'position', 'subtext']
  const result = Object.fromEntries(fields.map(field => [field, String(scene?.[field] ?? '')]))
  result.dialogue = (Array.isArray(scene?.dialogue) ? scene.dialogue : []).map(line => Object.fromEntries(dialogueFields.map(field => [field, String(line?.[field] ?? '')])))
  return result
}

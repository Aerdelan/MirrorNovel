const test = require('node:test');
const assert = require('node:assert/strict');

const { buildTemplatePrompt, typeTemplates } = require('../config/novelTemplates');

test('buildTemplatePrompt works when imported as a standalone function', () => {
  const template = typeTemplates.find((item) => item.gender === 'male');
  assert.ok(template, 'expected a male template fixture');

  const prompt = buildTemplatePrompt([{ name: template.name }], 'male');

  assert.equal(typeof prompt, 'string');
  assert.ok(prompt.length > 0);
});

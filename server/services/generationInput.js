// Store only creation controls, never request headers, model routes or keys.
function captureGenerationInput(body = {}) {
  const text = value => typeof value === 'string' ? value : '';
  const strings = value => Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
  const sku = body.typeSku && typeof body.typeSku === 'object' ? body.typeSku : null;
  return {
    version: 1,
    novelTypeId: text(body.novelTypeId),
    gender: body.gender === 'female' || sku?.channel === 'female' ? 'female' : 'male',
    typeSku: sku ? { channel: text(sku.channel), category: text(sku.category), theme: text(sku.theme), elements: strings(sku.elements), personas: strings(sku.personas), tones: strings(sku.tones), cp: text(sku.cp) } : null,
    protagonistName: text(body.protagonistName), worldSetting: text(body.worldSetting),
    targetWordCount: Number(body.targetWordCount) || 50000,
    chapterWordTarget: Number(body.chapterWordTarget) || 3000,
    mode: body.mode === 'chapter' ? 'chapter' : 'book',
    expertMode: body.expertMode === true || body.expertMode === 'true' || body.expertMode === 1,
    outline: text(body.outline), personaId: body.personaId ? String(body.personaId) : '',
    referenceIds: strings(body.referenceIds), referenceExamplesEnabled: body.referenceExamplesEnabled === true,
    structurePattern: text(body.structurePattern),
    storyBlueprint: body.storyBlueprint ? JSON.parse(JSON.stringify(body.storyBlueprint)) : null,
    enableResearch: body.enableResearch === undefined || body.enableResearch === true || body.enableResearch === 'true' || body.enableResearch === 1,
    researchLinks: Array.isArray(body.researchLinks) ? strings(body.researchLinks) : text(body.researchLinks).split(/[\n,，]/).map(s => s.trim()).filter(Boolean),
  };
}

function readGenerationInput(novel) {
  if (novel.generationInput?.version === 1) return { input: captureGenerationInput(novel.generationInput), exact: true };
  return { exact: false, input: captureGenerationInput({
    novelTypeId: novel.novelTypeId, typeSku: novel.typeSku,
    protagonistName: novel.protagonistName, worldSetting: novel.worldSetting,
    targetWordCount: novel.targetWordCount, chapterWordTarget: novel.chapterWordTarget,
    expertMode: novel.expertMode, outline: novel.outline, personaId: novel.writingPersonaId,
    referenceIds: (novel.referenceStyleSnapshot || []).map(ref => String(ref.referenceId || '')).filter(Boolean),
    referenceExamplesEnabled: (novel.referenceStyleSnapshot || []).some(ref => ref.keyExcerpts?.length),
    structurePattern: novel.structureReference, storyBlueprint: novel.storyBlueprint,
  }) };
}
module.exports = { captureGenerationInput, readGenerationInput };

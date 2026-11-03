// Parse complete JSON documents, never promote a fragment's nested phase/card
// into the top-level blueprint. Ignore braces/commas inside quoted story text.
function removeTrailingCommas(text) {
  let output = '', quoted = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (!quoted && char === ',' && /^[\s]*[}\]]/.test(text.slice(i + 1))) continue;
    output += char;
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
  }
  return output;
}

function documents(text) {
  const source = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '');
  const found = [];
  let start = -1, quoted = false, escaped = false, stack = [];
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (start < 0) {
      if (char !== '{' && char !== '[') continue;
      start = i; stack = [char]; quoted = false; escaped = false;
      continue;
    }
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === '{' || char === '[') stack.push(char);
    if (char === '}' || char === ']') {
      const opening = stack.pop();
      if ((char === '}' && opening !== '{') || (char === ']' && opening !== '[')) {
        start = -1; stack = []; continue;
      }
      if (!stack.length) {
        try { found.push(JSON.parse(removeTrailingCommas(source.slice(start, i + 1)))); } catch {}
        start = -1;
      }
    }
  }
  return found;
}

function unwrap(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 5) return null;
  if (!Array.isArray(value) && ('mainArc' in value || 'phases' in value || 'rollingPlan' in value)) return value;
  const candidates = Array.isArray(value) ? value : ['blueprint', 'storyBlueprint', 'data', 'result'].map(key => value[key]);
  for (const candidate of candidates) {
    const result = unwrap(candidate, depth + 1);
    if (result) return result;
  }
  return null;
}

function inspectBlueprintPayload(text) {
  const roots = documents(text);
  const candidates = roots.map(value => unwrap(value)).filter(Boolean);
  const parsed = candidates.find(value => typeof value.mainArc === 'string' && value.mainArc.trim()
    && Array.isArray(value.phases) && value.phases.length && value.rollingPlan && typeof value.rollingPlan === 'object')
    || candidates[0] || null;
  const missingFields = !parsed ? ['mainArc', 'phases', 'rollingPlan'] : [
    !(typeof parsed.mainArc === 'string' && parsed.mainArc.trim()) && 'mainArc',
    !(Array.isArray(parsed.phases) && parsed.phases.length) && 'phases',
    !(parsed.rollingPlan && typeof parsed.rollingPlan === 'object' && !Array.isArray(parsed.rollingPlan)) && 'rollingPlan',
  ].filter(Boolean);
  return { parsed, valid: missingFields.length === 0, missingFields,
    reason: !roots.length ? 'invalid_json' : missingFields.length ? 'missing_fields' : null };
}

function parseBlueprintPayload(text) { return inspectBlueprintPayload(text).parsed; }

module.exports = { parseBlueprintPayload, inspectBlueprintPayload };

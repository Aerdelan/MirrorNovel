import base64
s = """
function matchTemplates(ws, st) {
  if (!ws || !ws.trim()) return [];
  const tokens = ws.replace(/[\\u3000-\\u3011\\s,.!?;:()\\[\\]]/g, " ").split(/\\s+/).filter(t => t.length >= 2);
  if (tokens.length === 0) return [];
  const matched = [];
  for (const t of novelTemplates) {
    const kw = t.keywords || [];
    if (kw.length === 0) continue;
    let m = 0;
    for (const token of tokens) {
      for (const k of kw) {
        if (token.includes(k) || k.includes(token)) { m++; break; }
      }
    }
    const sc = Math.max(m / tokens.length, m / kw.length);
    if (sc >= 0.2) matched.push({ name: t.name, score: Math.round(sc * 100), contextPrompt: t.contextPrompt || "" });
  }
  return matched.sort((a, b) => b.score - a.score).slice(0, 3);
}

router.post("/match-templates", auth, async (req, res) => {
  try {
    const { worldSetting, novelTypeId } = req.body;
    if (!worldSetting || !worldSetting.trim()) return res.json({ matched: [] });
    const matched = matchTemplates(worldSetting, novelTypeId);
    res.json({ matched });
  } catch (error) {
    console.error("tmpl match error:", error);
    res.json({ matched: [] });
  }
});
"""
print(base64.b64encode(s.encode()).decode())

// Shared by streaming and non-streaming editing. The original text, not the
// first model draft, is the factual and stylistic baseline for the final pass.
function hasAcceptableRewriteLength(candidate, original) {
  if (typeof candidate !== 'string' || typeof original !== 'string' || !original.trim()) return false;
  const ratio = candidate.trim().length / original.trim().length;
  return ratio >= 0.8 && ratio <= 1.2;
}

function buildRewriteReviewPrompt(original, candidate, personaPrompt = '') {
  return `${personaPrompt ? `${personaPrompt}\n\n` : ''}你是同一位小说编辑。请对候选稿做最后一轮校稿，原文是唯一的事实基准。

【保真优先级】
1. 保留原文的角色、身份、关系、地点、时间顺序、道具、行动结果、线索、伏笔、揭示和结尾落点，不增加原文没有的事件或设定。
2. 保持原文的叙事人称、视角人物、叙事距离和时态。候选稿若发生视角漂移或替人物补写其不可能知道的信息，必须恢复。
3. 保留每场戏和每段对话的核心意图；可以调整措辞，不得改变人物选择、信息量和因果关系。
4. 最终篇幅保持在原文的 80%-120%，这是校稿，不是扩写、缩写或另写一版。

【只处理确有问题之处】
1. 统一作者声线。沿用原文已经建立的词汇密度、叙述温度和幽默尺度，不擅自换成编辑自己的文风。
2. 把空泛判断、重复解释和套话改成视角人物当下能感知的具体观察、动作或选择，但细节必须与场景有关。
3. 检查动作、反应与结果之间的因果；检查对话是否有目标、回避、试探或潜台词，而不是轮流说明剧情。
4. 人物声音来自其背景、目标、情绪和彼此关系，不统一添加口头禅、填充词、粗口或碎片句。
5. 句长和段落长度服从场景：动作需要清楚，犹豫需要停顿，关系变化需要留白。不要按比例拆段或机械追求长短交替。
6. 沉重题材中的轻松只能来自人物关系或处境，并且要推进关系、信息或伏笔；不要在创伤、危险或哀痛中随机插入笑话。
7. 只清除与本书既定声线无关、为“显得像真人”而硬塞的噪声（无关走神、括号旁白、固定口头禅、故意语病、错误标点、突兀硬切）。若原文本就采用介入型/吐槽型叙述者，这是本书的风格特征而非噪声，必须保留，不得把有意的叙述者声音改写成中立隐形旁白。

若候选稿已经符合要求，保留原句。直接输出完整终稿，不要解释、标题或修改说明。

【原文：事实与叙事基准】
${original}

【第一轮候选稿】
${candidate}`;
}

module.exports = { hasAcceptableRewriteLength, buildRewriteReviewPrompt };

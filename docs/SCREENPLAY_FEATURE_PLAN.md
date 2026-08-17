# 剧本功能：产品与技术实施方案

## 1. 目标与边界

本功能将小说内容转化为可用于 AI 动画生产的结构化剧本。它不是单次自由文本改写，而是一条可追溯、可校对、可续作的转换流水线：先理解原著，再拆分故事，再生成剧本与分镜提示词，最后由用户编辑、导出或进入外部动画生产环节。

首期支持两种来源：

- **书架小说转换**：从已生成小说选择单章、章节范围或整本，保留原书的角色、伏笔、时间线和世界观。
- **TXT 导入转换**：上传 `.txt` 小说，完成编码识别、章节识别、清洗和分段后建立独立剧本项目。

不在首期直接对接特定视频模型或自动生成最终视频；首期先稳定输出规范剧本、分镜和可复用提示词，并为后续服务接入保留接口。

## 2. 用户体验与功能范围

### 2.1 入口与创建方式

1. 在书架小说详情增加“转为剧本”入口。用户选择：
   - 单章转剧本；
   - 多章合并为一集；
   - 章节范围批量转换；
   - 全书创建项目并按集分批处理。
2. 在剧本工作台增加“导入小说”入口，接受 TXT；前端预览识别出的书名、章节数量、字符数与章节标题，允许用户修正章节边界。
3. 创建时需填写或选择：目标时长、每集覆盖章节数、画面风格、对白保留程度、旁白比例、受众分级、是否生成分镜与动画提示词。

### 2.2 工作台信息架构

- **项目概览**：来源、处理进度、版本、角色数、场景数、待确认连续性问题。
- **故事圣经**：世界观、时代、视觉风格、角色设定、固定物件、禁用内容和术语表。
- **剧集列表**：每集的原文范围、梗概、时长估算、状态和版本。
- **剧本编辑器**：场景树、剧本正文、原文对照、连续性提示、版本历史。
- **分镜面板**：按场景/镜头查看景别、机位、动作、台词、时长与动画提示词。
- **资产提示词库**：角色、场景、道具的正向/负向提示词和一致性描述。

### 2.3 可编辑原则

AI 的每层产物都应可人工调整，且调整会成为后续生成的约束：

- 用户修改角色外形后，后续镜头提示词自动使用新设定；
- 用户锁定场景/对白后，重新生成其他部分时不得覆盖锁定内容；
- 修改剧本场景后，可单独重新生成该场景的分镜，不必重跑整集；
- 每次 AI 生成或人工保存均创建可回退版本。

## 3. 统一结构化输出（JSON 优先）

模型不得直接以自由文本作为系统唯一真相。所有生成步骤先产出并校验 JSON，再渲染为可读剧本文本、表格和导出文件。这样可稳定做连续性检查、局部重试、版本比对和外部动画服务对接。

### 3.1 核心层级

```text
ScreenplayProject
  ├─ StoryBible（故事/视觉圣经）
  ├─ CharacterBible[]（角色圣经）
  ├─ Episode[]（剧集）
  │   └─ Scene[]（场景）
  │       └─ Shot[]（镜头）
  ├─ ContinuityLedger（时间线、伏笔、状态连续性）
  └─ AssetPrompt[]（角色/场景/道具提示词）
```

### 3.2 场景 JSON 示例

```json
{
  "sceneNo": 3,
  "sourceRange": { "chapterIds": ["ch_12"], "paragraphStart": 18, "paragraphEnd": 29 },
  "heading": { "location": "旧城区钟表店", "time": "夜", "interiorExterior": "INT" },
  "dramaticPurpose": "主角发现父亲留下的线索，并决定追查",
  "conflict": "主角想带走怀表，店主坚持先回答一个问题",
  "characters": ["林晚", "周店主"],
  "continuity": {
    "before": ["林晚淋雨，外套潮湿"],
    "after": ["林晚获得刻有坐标的怀表"],
    "foreshadowing": [{ "id": "fs_014", "action": "plant", "detail": "怀表秒针偶尔倒转" }]
  },
  "beats": [
    { "type": "action", "content": "林晚推门，风铃迟半拍响起。" },
    { "type": "dialogue", "character": "周店主", "content": "你终于来了。", "subtext": "他早已知道林晚会来。" }
  ],
  "tone": "悬疑、克制，结尾给出微弱希望",
  "estimatedSeconds": 95
}
```

### 3.3 镜头 JSON 示例

```json
{
  "shotNo": 5,
  "durationSeconds": 4,
  "shotSize": "特写",
  "cameraMovement": "缓慢推近",
  "visualAction": "怀表表盖弹开，秒针逆向跳动一格。",
  "audio": "雨声压低，齿轮咬合声清晰",
  "dialogueRef": null,
  "animationPrompt": "fresh cinematic 2D animation, antique brass pocket watch close-up...",
  "negativePrompt": "text, watermark, extra fingers, inconsistent costume",
  "continuityRefs": ["asset_prop_pocket_watch_v1", "char_linwan_wet_coat_v1"]
}
```

JSON 使用服务端 Schema 校验（如 Zod/Joi/JSON Schema）；解析失败时要求模型只修复无效字段，不立即重写整段内容。所有 ID 由服务端生成，避免模型伪造引用。

## 4. 生成流水线

### 4.1 输入标准化

**书架小说**：读取小说章节、章节摘要、人物状态、伏笔台账和创作设定；原文只作为证据，不应每次完整塞入模型上下文。

**TXT 导入**：

1. 限制文件大小与编码白名单，识别 UTF-8 / UTF-8 BOM / GBK 等常见编码；
2. 清理广告、重复页眉页脚、空白行和异常控制字符；
3. 基于“第 N 章”“Chapter N”等规则初步分章，同时允许用户在预览页合并、拆分和改名；
4. 为每章生成摘要、人物/地点候选和事件索引，建立可追溯的段落坐标。

### 4.2 四阶段转换

1. **理解（Analyze）**
   - 生成故事圣经：题材、主题、叙事视角、人物关系、时间线、世界规则、风格约束；
   - 提取角色、地点、道具和伏笔；
   - 将不确定内容标记为 `needsReview`，不凭空补写原著事实。
2. **编排（Adapt）**
   - 按目标时长与选定章节划分剧集；
   - 为每集创建“改编契约”：本集核心冲突、必须保留事件、可合并内容、结尾钩子、禁止剧透内容；
   - 将原文事件拆为场景并保持 `sourceRange`。
3. **剧本（Script）**
   - 按场景生成场景标题、动作、对白、旁白、潜台词、情绪转折与时长；
   - 对话优先体现人物目标和潜台词，避免逐句复述旁白；
   - 原著内心戏改写为可表演的动作、反应、道具或必要旁白。
4. **分镜（Storyboard）**
   - 每场场景按镜头节奏拆分，生成景别、镜头运动、时长、声音设计和画面动作；
   - 结合角色/场景/道具圣经生成可复用的 AI 动画提示词；
   - 运行连续性与时长检查后再开放导出。

### 4.3 生成质量护栏

- 每次上下文中都包含本集契约、前一场结尾状态、角色圣经、已锁定资产和待回收伏笔；
- 单场只允许完成一个清晰戏剧功能，避免模型跳跃推进多个关键事件；
- 对话、动作与镜头必须服务冲突/信息/关系至少一项；
- 检查人物名称、服装、伤势、道具归属、时间、地点、已知信息和伏笔状态；
- 相邻场景检测重复事件、重复台词、镜头单调与时长异常；
- 校验失败只做一次定向修订；若仍失败，保存结果并标记人工复核，避免无限消耗 Token。

## 5. 数据模型建议

### 5.1 `ScreenplayProject`

```text
_id, userId, title, sourceType(novel|txt), sourceNovelId, sourceFile
status(draft|queued|processing|paused|completed|failed)
settings { targetDuration, visualStyle, dialogueDensity, narrationRatio, rating }
storyBible, characterBibleIds, continuityLedger
episodeIds, currentJobId, progress, createdAt, updatedAt
```

### 5.2 `ScreenplayEpisode`

```text
_id, projectId, episodeNo, title, sourceRange, adaptationContract
synopsis, estimatedSeconds, scenes[], status, activeVersionId
```

### 5.3 `ScreenplayScene` 与 `Shot`

```text
Scene: _id, episodeId, sceneNo, sourceRange, heading, dramaticPurpose, conflict, beats, continuity, status
Shot:  _id, sceneId, shotNo, durationSeconds, framing, cameraMovement, visualAction, audio, promptRefs
```

可将小型 `Scene/Shot` 内嵌以减少查询，也应预留独立集合方案；当全书镜头量和版本数增加后，推荐单独集合并对 `projectId/episodeId/sceneId` 建索引。

### 5.4 `AssetPrompt`、`ContinuityLedger` 与版本

```text
AssetPrompt: projectId, type(character|location|prop), name, canonicalDescription, positivePrompt, negativePrompt, referenceImages[], locked
ContinuityLedger: projectId, timeline[], characterStates[], propStates[], foreshadowing[], unresolvedIssues[]
ScreenplayVersion: projectId, entityType, entityId, revision, snapshot, changedBy(ai|user), note, createdAt
```

版本保存采用不可变快照或可回放 patch；单实体保留完整版本，项目级版本只记录引用，避免每次编辑复制整本剧本。

## 6. API 与异步任务设计

### 6.1 建议 API

```text
POST   /api/screenplays                         创建项目（小说 ID 或 TXT）
POST   /api/screenplays/:id/analyze             建立故事圣经
POST   /api/screenplays/:id/episodes/generate   创建剧集与场景计划
POST   /api/screenplays/:id/episodes/:no/script 生成/重生成剧本
POST   /api/screenplays/:id/scenes/:sceneId/shots 生成/重生成分镜
PATCH  /api/screenplays/:id/...                 保存人工编辑及锁定状态
POST   /api/screenplays/:id/jobs/:jobId/resume  断点续作
GET    /api/screenplays/:id/export?format=...   导出
```

任务状态通过现有 SSE 模式推送：阶段名称、当前剧集/场景、总量、可读提示、失败原因与可重试操作。前端刷新后通过项目和任务接口恢复显示，不能只依赖内存中的 SSE 连接。

### 6.2 队列、幂等与断点续作

- `ScreenplayJob` 持久化 `projectId`、任务类型、范围、输入哈希、状态、游标、重试次数、错误和输出引用；
- 任务以“分析 / 剧集计划 / 单集剧本 / 单场分镜”为最小可恢复单元，每完成一个单元立即写入数据库；
- 以 `projectId + jobType + targetId + inputHash` 作为幂等键，避免用户连点生成时重复扣费或写入；
- 模型/API 临时失败采用有限指数退避；超过次数改为 `paused` 或 `failed`，保留已完成结果；
- 用户编辑后的实体标记为 `locked`，恢复任务不得覆盖；输入来源变化时标记依赖内容为“需重新生成”。

首期可沿用现有进程内队列和 SSE，但需持久化任务状态；生产环境建议迁移 Redis + BullMQ/同类可靠队列，并配置死信与并发控制。

## 7. 导出与交付格式

支持以同一份结构化数据导出：

- **阅读版剧本**：Markdown / TXT / PDF，包含集标题、场景标题、动作、角色名、台词和旁白；
- **制作表**：CSV / XLSX，按场景或镜头输出时长、角色、场景、道具、声音和备注；
- **机器可读包**：JSON，保留 ID、提示词、资产引用、源文本范围与连续性信息；
- **动画提示词包**：按角色/场景/镜头归档正负提示词、推荐时长和参考资产。

导出任务也异步运行并生成只属于当前用户的临时下载文件；任何导出均进行权限校验，不允许通过 ID 访问他人项目。

## 8. 分阶段 MVP

### Phase 0：基础与验证（约 1 周）

- 新建 `ScreenplayProject`、任务记录和权限模型；
- 实现书架小说单章入口、结构化场景 JSON、阅读版剧本预览；
- 建立 JSON 校验、源段落追溯和失败可见性。

验收：一章小说可稳定生成可编辑的场景剧本；每个场景可定位回原章节和段落。

### Phase 1：单章到分镜（约 1–2 周）

- 角色/场景/道具圣经；
- 镜头 JSON、基础连续性检查、提示词面板；
- 单章内局部重生成、版本回退和 Markdown/JSON 导出。

验收：用户修改角色设定后，重生成镜头能够继承设定；镜头时长、总时长和资产引用可追踪。

### Phase 2：多章与 TXT 导入（约 2 周）

- TXT 上传、章节识别与人工校正；
- 多章合并成剧集、剧集契约、跨集时间线与伏笔台账；
- 队列持久化、SSE 进度、失败恢复与批量导出。

验收：长文本任务中断后可从最后完成的剧集继续，且不会覆盖已手工修改内容。

### Phase 3：整本生产与外部动画衔接（约 2–3 周）

- 全书分批排队、成本/Token 统计、质量报告；
- 场景、镜头、资产一致性审查；
- 抽象 `AnimationProvider` 接口，支持将锁定的镜头提示词提交给图像/视频生成服务，回收生成资产链接。

验收：整本可分批转换、恢复和导出；同一角色跨集提示词和资产引用保持一致。

## 9. 实施顺序与风险控制

1. 先实现 JSON Schema、项目/任务/版本数据模型，再做界面；
2. 先打通“已生成小说的单章转场景剧本”，以真实小说验证质量；
3. 再加入分镜和资产提示词，最后扩展 TXT 和整本批处理；
4. 所有模型结果在写库前必须解析、校验、脱敏和权限归属检查；
5. 对长文本采用摘要 + 检索 + 段落引用，不传整书全文；
6. 为每个任务记录模型、提示词模板版本、输入哈希、Token/耗时与错误，便于回归和成本控制。

关键产品风险是“剧本看似完整但改编失真”。因此应始终展示原文对照和来源范围，并把删改/合并/新增内容显式标记；关键角色设定、结局和伏笔回收必须默认要求人工确认。

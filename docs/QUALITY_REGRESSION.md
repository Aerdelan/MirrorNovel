# 写作质量回归集（A5）——覆盖映射与真实对比工具使用说明

编写日期：2026-10-25。对应 `docs/WRITING_STYLE_ROADMAP.md` §4-A5。

本文回答两个问题：**自动化回归清单每一项由哪个测试守护**；**真实模型 A/B 对比怎么跑、跑到什么程度才算数**。

## 1. 自动检查覆盖映射

自动测试使用模拟 AI、隔离数据库与浏览器接口拦截，从不调用真实付费模型。清单逐项映射（"既有"指 A1–A4 之前/期间建立的测试）：

| 清单项 | 守护测试 | 说明 |
| --- | --- | --- |
| 账号隔离（样稿/版本/偏好/作品） | `creativeFeatures.integration.cjs`：writing sample / style revisions / feedback & preferences 三个用例的跨账号 404 断言 | 跨账号读写、外部样稿引用、外部版本采用均 404/400 |
| 作品隔离（别书偏好不泄漏） | 同上，feedback & preferences 用例 | 两本书分别采用同一版本，快照各含各的偏好 |
| 风格版本隔离与固定 | 同上，style revisions 用例；`styleRevisions.test.js` | 采用后快照不受后续版本/偏好变化影响；同章轮换恒定 |
| 输入预算与截断策略 | `writingSamples.test.js`（240 字样稿）、`styleContext.test.js`（偏好 200 字、样稿预算钳制）、`writingStyle.test.js`（反馈存储 4000 字截断+完整长度审计）、`qualityRegression.test.js` 汇总断言 | 预算显式常量，禁止静默膨胀 |
| 授权状态（草稿/撤销不入池） | `writingSamples.test.js` 池门用例 + 集成 | 只有 approved+allowed 进入候选池 |
| 版本固定（任务期间） | 集成：续写提示词不含采用后新增样稿/偏好 | 生成链路只读冻结快照 |
| 失败回退（篇幅漂移保原稿） | `novelGeneration.integration.test.js` L430/L454；`referenceStyleExamples.test.js` rewriteReview 用例 | 流式去AI味两轮长度校验，失败保留原文 |
| 暂停续接（断点草稿） | `novelGeneration.integration.test.js` L967–1032（draft_restored、已完成草稿直接提交不重复调用） | content 事件仅为预览，提交以 checkpoint commit_ready 为准 |
| 重复写入保护 | `qualityRegression.test.js`（finalizeGeneratedChapter 重复章号抛"已阻止重复写入"，已提交内容逐字节不变）；集成 A2 用例的 mongoose push-clone 回归守卫 | 章节提交防重 |
| 人格/原文/样稿/任务要求冲突时的优先级 | `styleContext.test.js` + `qualityRegression.test.js` 组合用例：人格声线、偏好、样稿块共存于同一提示；prose/revise 边界均声明"作品事实、人物、写作人格优先"；`personaConstraint` 真实人格优先、无人格不编造 | 优先级在提示词中显式声明并被组合测试锁定；语义级冲突需真实盲测（见下） |
| 噪声指令不回流 | `creativeFeatures.integration.cjs` A4 用例：editorial 各阶段 system 不含"走神/废信息/模仿乌贼/教育/年龄" | editorialEngine 去随机作者 |
| 流式片段不作为终稿 | checkpoint 设计 + `novelGeneration.integration.test.js` 断点用例；`creativeFeatures.integration.cjs` 续写提交内容断言 | `completed`/commit 才落库 |
| 手工修改/章节历史/草稿恢复/并发编辑/导出 | `desktop/tests/editingSafety.test.mjs`（浏览器级）+ `creativeFeatures.integration.cjs` 场景保存与版本用例 | 行为保持不回归 |
| 各修订入口实际携带风格上下文 | `creativeFeatures.integration.cjs` A4 用例（捕获实际 system/prompt 断言，非关键词检查） | deslop/polish/editorial 全阶段；导入续写源码级守护（不注入） |

运行方式：

```powershell
npm --prefix server test                     # 全部单元（含 qualityRegression）
npm --prefix server run test:creative-integration   # 隔离数据库集成（本机 Mongo 可用时）
node --test tests/creativeWorkbench.test.mjs tests/novelWorkbench.test.mjs tests/editingSafety.test.mjs   # desktop 目录，接口拦截
```

## 2. 真实模型 A/B 对比工具与验证状态

**现状声明：规划书已记录首轮真实对比及作者初评，但尚未证明质量提升**——见 `WRITING_STYLE_ROADMAP.md` 的 A5 验证记录：作者初评为两版结尾仍模板化、风格差异不明显，完整盲选未完成。2026-10-26 本轮代码审查没有新增真实模型调用，修复后的语义效果仍需另行验证。自动测试与提示词断言不能替代真实成稿盲测。

后续真实调用需选定线路、作者实际认可的样稿、场景和费用预算后显式触发。工具已就绪并验证安全守卫：

### 2.1 准备

1. 复制 `server/scripts/quality-scenarios.example.json` 为 `quality-scenarios.json`，按需修改：
   - `scenarios`：五类固定场景（对话交锋/行动/关系变化/观察/情绪收束）；
   - `persona`：本书声线（至少准备两种差异明显的声线，各跑一轮）；
   - `styleContext`：A 组注入的认可样稿与已确认偏好（与样稿库内容一致）。
2. 写一个线路文件 `quality-route.json`（**不要提交、不要用仓库密钥**）：

```json
{ "baseUrl": "https://你的服务商/v1", "apiKey": "你的密钥", "models": { "writing": "模型名", "reasoning": "评审用模型名" } }
```

### 2.2 执行

```powershell
cd server
npm run quality:ab -- --config ../quality-route.json --scenarios ./quality-scenarios.json --out ./quality-reports --yes
# 可选：追加评审模型的证据说明（辅助，不评分）
npm run quality:ab -- --config ../quality-route.json --scenarios ./quality-scenarios.json --out ./quality-reports --yes --judge
```

产出 `quality-reports/<时间戳>/`：`pairs.json`（匿名 P1/P2 成对文本，顺序已随机）、`key.json`（P1/P2 真实映射，盲选后才能看）、`summary.json`（调用次数/失败率/Token/等待时间）、`report.md`（作者盲选清单）。

### 2.3 判读与发布门槛

1. 作者对每对盲选 P1/P2 并写一句理由（工具不代替选择；评审模型证据仅辅助说明）。
2. 盲选完成后对照 `key.json` 统计 A（注入上下文）胜率，并人工核对事实与因果、人物声音、重复程度、自然度。
3. **发布门槛**：`npm --prefix server test` 与集成/桌面回归全绿，且小范围真实对比没有出现事实保真或连续性明显退化。未做真实对比时，任何交付不得声称"写作质量已提高"。
4. 密钥安全：线路文件不要提交进仓库；报告目录不包含任何密钥。

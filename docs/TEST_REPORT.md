# 测试报告 — 连贯性优化与安全加固

- 日期：2026-09-08
- 分支：main
- 基线提交：`17492df`（Merge branch 'main' of github.com:Aerdelan/MirrorNovel）
- 结论：**服务端测试 72/72 通过，客户端构建通过。四部 10 万字 GLM-4.5 实测因线路不可用未执行**（见第 5 节）。

---

## 1. 测试范围

本轮验证覆盖四组改动：

| 改动组 | 内容 | 验证方式 | 结果 |
|---|---|---|---|
| 章节连贯性优化 | 上一章压缩承接、伏笔回收判定升级、章末结构化自评 | 单元测试 3 例新增 + 既有集成测试回归 | ✅ 72/72 |
| 安全加固 | helmet、CORS 收紧、登录/验证码限流、错误响应脱敏 | 全量回归（脱敏后的响应结构被既有集成测试覆盖） | ✅ 72/72 |
| 前端 SSE 重构 | `useSSE` composable，迁移 5 处重复的 XHR 流式解析 | `npm run build` + 集成测试回归 | ✅ 构建通过 |
| 超时常量 | `config/timeouts.js`，接入大纲/蓝图两个调用点 | 全量回归 | ✅ 72/72 |

## 2. 服务端自动化测试

命令：`cd server && npm test`（node:test + node:assert/strict）

```
ℹ tests 72
ℹ pass 72
ℹ fail 0
```

### 2.1 连贯性优化新增用例

1. **`compressPreviousChapter keeps beginning, turning point and ending instead of tail only`**
   验证上一章承接摘要包含「开端 + 关键转折 + 章末」三段，短章节原样返回、空串安全。此前 `previousEnd` 只取末尾 260 字，上一章结尾是回忆/插叙时会错位衔接。

2. **`hook resolution tolerates reworded prose via 2-gram coverage`**
   验证措辞改写后的伏笔回收：第 1 章埋设「铜钥匙的下落」，第 2 章正文写作「那把黄铜钥匙正是通向地下室的下落所在」（不含完整字面），2-gram 覆盖率判定命中并标记 `resolved`。**分层设计**：启发式覆盖中度改写；完全重写的极端场景由章末自评兜底（见 2.2）。

3. **`applyHookAudit patches missed resolutions, adds unplanned hooks and updates characters`**
   验证模型章末自评 JSON 的回填：补标启发式漏掉的回收（带正文证据）、补录契约外实际埋设的伏笔、按名字 upsert 角色状态（位置/情绪/目标），并验证幂等（重复应用不重复计数）。

### 2.2 章末结构化自评（`auditChapterHooks`）

- 每章落库后用 `reasoning` 线路做一次小调用（预算 2500 token、超时 180s、temperature 0.2）；
- 任何失败（超时/解析失败/异常）**静默返回 null**，本章保留启发式判定结果，不阻塞生成主流程；
- 集成测试中该调用被 mock 归类为 `hookAudit`，4 处既有断言已适配（过滤该调用后断言原始调用序列）。

## 3. 安全加固验证

| 项 | 实现 | 验证 |
|---|---|---|
| HTTP 安全头 | `helmet()`（关闭 CORP/COEP 以兼容移动端与跨域资源） | 服务启动 + 全量回归 |
| CORS 收紧 | 按 `CORS_ORIGIN` 白名单（默认仅本地开发端口）；生产前后端同源不受影响 | 代码审查 |
| 接口限流 | 登录/注册 30 次/15 分钟；验证码/重置 10 次/小时 | 代码审查（限流挂载于 `index.js`，集成测试自行组装 app 不经过限流层，无自动化用例） |
| 错误脱敏 | 全部路由 500 响应移除 `error: error.message`（34 处）；`persona.js` 7 处改为仅透传带 `isApiError` 的业务错误；全局错误中间件统一兜底文案 | 代码审查 + 集成测试回归 |

**说明**：SSE 流式错误事件保留透传（多为 AI 服务商业务消息，如「余额不足」「暂不支持深度推理模型」，用户需要看到具体原因）。

## 4. 前端重构验证

- `useSSE` composable 收口 5 处重复的 XHR + onprogress + 缓冲解析（GeneratePage 大纲/蓝图/去AI味/编辑引擎，NovelDetailPage 续写）；
- `npm run build` 通过，GeneratePage 产物 41.38kB → 39.58kB；
- 既有集成测试（含 SSE 端到端行为）全部回归通过。

## 5. 四部 10 万字 GLM-4.5 实测 — **未执行**

**状态：被线路可用性阻塞，尚未运行。**

探测结果（2026-09-08）：

| 线路 | 模型 | 探测结果 |
|---|---|---|
| normal_1（tokenrhythm 中继） | glm-4.5 | `MODEL_NOT_AVAILABLE`（该中继不支持此模型） |
| normal_1（tokenrhythm 中继） | glm-5.3-flash | key 可用，但为强制深度推理模型，被平台拒绝接入 |
| normal_2~svip（siliconflow） | DeepSeek-V4-Flash / zai-org/GLM-4.5-Air | `402 余额不足` |
| .env 兜底（bigmodel） | glm-4.5-air | `401 身份验证失败`（key 无效） |

**解除阻塞三选一**：① siliconflow 充值（key 现成有效）；② 更新 `server/.env` 的 `AI_API_KEY` 为有效的 bigmodel key；③ 提供其他支持 GLM-4.5 的 base_url + key。

**测试脚本已就绪**：`.tmp/four-novels.js` —— 4 部不同题材（悬疑灵异/玄幻/仙侠/都市）、各 10 万字、3000 字/章（约 34 章）、预置大纲直接进入正文、4 本并行 SSE 生成，事件流落盘 `.tmp/devlogs/test-novel-{题材}.log`。

**开跑后将从 DB 汇总**：每本完成字数/章节数、伏笔账本 resolved/pending/abandoned 分布、`[HookAudit]` 自评命中数、质量告警次数、是否触发 `plan_needs_extension`。

## 6. 已知限制与后续建议

- JWT 无撤销机制（改密码后旧 token 有效至过期）——建议加 `tokenVersion`；
- `novel.js`（3400+ 行）/ `GeneratePage.vue`（2200+ 行）拆分未做；
- `chapterToolchain.js`、`editorialEngine.js` 等核心引擎仍缺专属单测；
- 限流层目前无自动化用例（挂载在入口文件，需入口级测试才能覆盖）；
- `foreshadowingDoc`（正则启发式文本通道）与 `foreshadowingLedger`（结构化账本）仍双轨并存，建议后续统一到账本单轨。

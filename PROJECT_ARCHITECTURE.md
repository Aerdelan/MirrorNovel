# MirrorNovel 项目逻辑关系文档

> 本文档以当前代码为准，描述当前仍在维护的模块、数据流和接口。

## 一、项目全景

MirrorNovel 是一个 AI 小说创作平台，提供小说生成、轻小说生成、导入续写、书架管理、文本润色、编辑引擎、写作人格和模型线路配置。

### 技术栈

| 层 | 技术 | 当前职责 |
|---|---|---|
| 用户端 Web | Vue 3 + Pinia + Vue Router + Vite | 生成、续写、润色、书架、个人资料和登录 |
| 管理端 Web | Vue 3 + Pinia + Vue Router + Vite | 用户管理和模型配置 |
| App 端 | uni-app Vue 3 | 移动端生成、续写、润色、书架和个人资料 |
| 服务端 | Node.js + Express | REST API、SSE 流式生成、鉴权和任务调度 |
| 数据库 | MongoDB + Mongoose | 用户、小说、写作人格、系统配置和验证码 |
| AI 引擎 | OpenAI-compatible HTTP API | 大纲、正文、续写、推理审稿、润色和编辑任务 |
| 外部采集 | Playwright + HTTP + 字体映射工具 | 番茄内容导入与字体解码辅助 |

## 二、模块依赖关系

```text
用户端 Web / App / 管理端
        │  Axios / fetch / SSE
        ▼
server/index.js
        ├── /api/auth       routes/auth.js       ── User / VerificationCode
        ├── /api/novel      routes/novel.js      ── Novel
        ├── /api/persona    routes/persona.js    ── WritingPersona
        └── /api/admin      routes/admin.js      ── User / SysConfig / modelCatalog
                │
                ├── services/aiService.js
                ├── services/novelContext.js
                ├── services/storyState.js
                ├── services/editorialEngine.js
                ├── services/chapterToolchain.js
                ├── services/writingAgent.js
                └── services/fanqieScraper.js / playwrightProxy.js
                                │
                                ▼
                         MongoDB
```

### 当前前端路由

| 路径 | 页面 | 说明 |
|---|---|---|
| `/generate` | GeneratePage | 普通小说和轻小说生成 |
| `/continue` | ContinuePage | 导入文本或已有作品续写 |
| `/bookshelf` | BookshelfPage | 作品列表、暂停、继续、导出 |
| `/novel/:id` | NovelDetailPage | 章节查看、编辑、蓝图和编辑任务 |
| `/polish` | PolishPage | 文本润色和去 AI 化 |
| `/profile` | ProfilePage | 用户资料和模型线路配置 |
| `/login` | LoginPage | 登录 |
| `/register` | RegisterPage | 注册和邮箱验证码 |
| `/forgot-password` | ForgotPasswordPage | 重置密码 |

## 三、功能模块

### 3.1 用户认证与模型配置

`server/routes/auth.js` 负责注册、登录、JWT 鉴权、个人资料、模型配置、邀请信息、公告和 Ollama 模型探测。密码由 `bcryptjs` 加密，验证码使用 `VerificationCode` 并带 TTL 过期索引。

模型配置保留两层：

1. 用户级任务线路：outline、writing、reasoning、polish。
2. 管理端线路目录：由 `server/config/modelCatalog.js` 和环境变量生成，数据库中的 `SysConfig(model_catalog)` 可覆盖线路配置。

模型配置描述供应商、接口地址、模型名、密钥和任务线路。

### 3.2 小说生成

`server/routes/novel.js` 和 `server/services/aiService.js` 是核心链路，支持：

- 普通小说与轻小说类型。
- 单章或整本生成。
- 大纲生成和用户确认。
- 初始故事蓝图生成、编辑和确认。
- 章节计划、伏笔、角色状态、情绪曲线和故事完成度。
- SSE 流式正文、思考状态、章节状态和完成事件。
- 可选专家模式：正文完成后进行推理审稿和修订。

### 3.3 写作人格

`WritingPersona` 保存作者声线、语气节奏、规则、词汇和适用题材。系统预设、用户手动模板和 AI 生成模板都通过 `routes/persona.js` 管理。生成小说时会保存 `writingPersonaSnapshot`，避免后续修改模板导致旧作品风格漂移。

### 3.4 续写与故事上下文

续写由 `/api/novel/continue/:novelId`、`/continue-import` 和指定章节接口提供。`novelContext.js` 持久化章节摘要、伏笔文档、事实、未决问题和阶段检查点；`storyState.js` 负责章节计划、创作状态、连续性检查和故事蓝图。

### 3.5 润色与编辑管线

小说路由提供文本润色、去 AI 化、章节关键字、后台调优和编辑引擎任务。`editorialEngine.js` 按人格、结构、风格一致性和语言修订等阶段处理章节，并通过任务状态接口查询进度。结果可以保存回指定章节或导出文本。

### 3.6 番茄导入辅助

`fanqieScraper.js`、`fanqieAuth.js`、`playwrightProxy.js`、`fontDecoder.js` 和字体映射脚本用于获取公开内容、下载章节及处理字体映射。该能力属于导入续写辅助，不是独立的参考库或风格提取系统。

### 3.7 管理端

管理端当前只保留：

- 基础数据概览：用户数、小说数、完成数、进行中数量。
- 用户搜索、禁用和启用。
- 模型线路查看、接口地址/模型名/API Key 配置。

## 四、关键数据流

### 4.1 新建小说

```text
GeneratePage
  → GET /novel/types/full
  → POST /novel/generate-outline（可选）
  → POST /novel/generate-blueprint（整本模式）
  → POST /novel/generate
  → SSE: novel_created / outline / chapter_start / content / chapter_end / completed
  → Novel.chapters + story state 持久化
```

服务端会解析类型、匹配类型模板、注入写作人格、生成章节计划，并使用 `processChapter`、`novelContext` 和 `storyState` 更新作品状态。

### 4.2 续写已有小说

```text
BookshelfPage / ContinuePage
  → GET /novel/bookshelf 或 GET /novel/:id
  → POST /novel/continue/:novelId
  → buildAugmentedContext / selectRelevantHistory
  → streamGenerate
  → 连续性检查、摘要、伏笔和章节保存
```

导入续写使用 `buildImportContinuePrompt`，保留导入文本的剧情与人物上下文。

### 4.3 密码找回

```text
ForgotPasswordPage
  → POST /auth/send-reset-code
  → VerificationCode(type=reset, 10分钟有效)
  → POST /auth/reset-password
  → bcrypt 加密新密码并删除已使用验证码
```

## 五、API 路由表

### 认证 `/api/auth`

| 方法 | 路径 | 用途 | 鉴权 |
|---|---|---|---|
| POST | `/send-code` | 注册验证码 | 否 |
| POST | `/send-reset-code` | 密码重置验证码 | 否 |
| POST | `/reset-password` | 使用验证码重置密码 | 否 |
| POST | `/register` | 注册 | 否 |
| POST | `/login` | 登录 | 否 |
| GET | `/profile` | 当前用户资料 | 是 |
| PUT | `/profile` | 更新昵称 | 是 |
| GET/PUT | `/model-config` | 获取/保存模型配置 | 是 |
| GET | `/stats` | 用户写作统计 | 是 |
| GET | `/invite-info` | 邀请信息 | 是 |
| GET | `/announcement` | 公告状态 | 是 |
| POST | `/dismiss-announcement` | 关闭公告 | 是 |
| GET/POST | `/ollama/models` | Ollama 模型探测 | 是 |

### 小说 `/api/novel`

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/types`、`/types/full`、`/types/map` | 小说类型数据 |
| POST | `/generate-outline` | 生成大纲 |
| POST | `/generate-blueprint` | 生成初始故事蓝图 |
| POST | `/generate` | 创建并流式生成小说 |
| POST | `/continue/:novelId` | 继续生成 |
| POST | `/continue-import` | 导入文本续写 |
| GET | `/bookshelf` | 用户书架 |
| GET | `/:novelId` | 小说详情 |
| DELETE | `/:novelId` | 删除小说 |
| POST | `/pause/:novelId` | 暂停生成 |
| PUT | `/:novelId/outline` | 更新大纲 |
| PUT/DELETE | `/:novelId/chapter/:chapterNumber` | 编辑/删除章节 |
| POST | `/:novelId/continue-chapter/:chapterNumber` | 指定章节续写 |
| GET/PUT/POST | `/:novelId/blueprint*` | 蓝图设置、审核和提案决定 |
| POST | `/match-templates` | 匹配类型模板 |
| POST | `/deslop`、`/deslop-stream` | 去 AI 化 |
| POST | `/polish`、`/polish-export`、`/polish-save` | 润色、导出和保存 |
| POST | `/chapter-keywords/:novelId/:chapterNumber` | 章节关键字 |
| POST | `/optimize/:novelId`、`/optimize-status/:novelId` | 后台调优 |
| POST | `/editorial-stream`、`/editorial-book/:novelId`、`/editorial-status/:novelId` | 编辑引擎 |

### 写作人格 `/api/persona`

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/`、`/:id` | 列表和详情 |
| POST | `/` | 新建模板 |
| PUT | `/:id` | 更新模板 |
| DELETE | `/:id` | 删除用户模板 |
| POST | `/:id/clone` | 克隆模板 |
| POST | `/ai-generate` | AI 生成模板 |

### 管理端 `/api/admin`

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/dashboard` | 管理概览 |
| GET | `/users` | 用户列表 |
| PUT | `/users/:id` | 修改用户状态 |
| GET | `/models` | 模型线路配置 |
| PUT | `/models` | 保存模型线路配置 |

## 六、数据模型

| 集合 | Model | 主要内容 |
|---|---|---|
| `users` | User | 邮箱、bcrypt 密码、角色、邀请信息、模型配置 |
| `novels` | Novel | 作品设定、章节、计划、蓝图、上下文、编辑任务 |
| `writingpersonas` | WritingPersona | 作者声线、语气、规则、词汇和适用题材 |
| `sysconfigs` | SysConfig | 模型目录等通用 KV 配置 |
| `verificationcodes` | VerificationCode | 注册/重置验证码和过期时间 |

## 七、部署与开发

服务端从 `server/.env` 读取 `MONGODB_URI`、`JWT_SECRET`、邮件 SMTP 和 AI 模型线路配置。默认 Express 端口为 3000；客户端 Vite 默认端口为 5173，并将 `/api` 代理到 `http://localhost:3000`；管理端使用独立 Vite 端口配置。

常用命令：

```powershell
cd server; npm start
cd client; npm run dev
cd client; npm run build
cd admin; npm run build
cd app; npm run build:h5
```

后端启动前必须确保 MongoDB 可连接。生产环境建议使用已构建的静态文件和进程管理器，并为数据库、JWT、SMTP 和模型 API Key 配置安全的环境变量。

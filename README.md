<p align="center">
  <a href="#readme-zh">简体中文</a> | <a href="#readme-en">English</a>
</p>

<a id="readme-zh"></a>

# MirrorNovel

> 面向长篇创作的 AI 小说生成、续写、润色与故事连贯性管理平台。

MirrorNovel 将小说类型、写作人格、大纲、故事蓝图、章节计划和持续上下文结合到同一创作流程中。它包含用户端 Web、管理端 Web、uni-app 移动端和 Express 服务端。

## 目录

- [核心能力](#核心能力)
- [功能概览](#功能概览)
- [项目结构](#项目结构)
- [环境要求](#环境要求)
- [快速开始](#快速开始)
- [环境变量](#环境变量)
- [模型线路配置](#模型线路配置)
- [使用流程](#使用流程)
- [API 概览](#api-概览)
- [测试与构建](#测试与构建)
- [部署建议](#部署建议)
- [安全说明](#安全说明)
- [开源协议](#开源协议)

## 核心能力

| 能力 | 说明 |
|---|---|
| 小说生成 | 支持普通小说、轻小说、单章和整本两种创作模式 |
| 大纲与蓝图 | 先生成大纲，再让用户确认故事蓝图、阶段、支线和反转 |
| 连续性管理 | 持久化章节摘要、伏笔、角色状态、情绪曲线、事实和未决问题 |
| 写作人格 | 使用系统预设、手动模板或 AI 生成模板控制叙述声线和节奏 |
| 导入续写 | 导入 TXT 后保持已有剧情、人物和设定继续写作 |
| 润色与编辑 | 提供文本润色、去 AI 化、章节优化和编辑引擎工作流 |
| 模型线路 | 支持默认线路以及 outline、writing、reasoning、polish 的任务级线路 |
| 管理端 | 提供用户状态管理、基础概览和模型线路配置 |
| 多端 | 提供 Vue Web 用户端、管理端及 uni-app 移动端页面 |

## 功能概览

### 小说创作

1. 选择男频、女频或轻小说题材。
2. 填写主角和世界观，可让系统生成大纲。
3. 在整本模式中确认初始故事蓝图。
4. 选择写作人格和任务线路。
5. 服务端通过 SSE 推送大纲、章节状态、思考进度、正文和完成事件。
6. 每章写入作品后同步更新计划、上下文、伏笔和创作状态。

### 续写与书架

- 从书架继续整本作品，或针对指定章节补写。
- 导入 `.txt` 小说文本后继续创作。
- 查看、编辑、删除章节并导出作品。
- 上下文服务自动汇总近期剧情、角色状态、伏笔和阶段记忆，减少长篇续写漂移。

### 写作人格

写作人格由以下内容构成：

- 作者声线：视角、叙述距离、人称和叙述温度。
- 语气与节奏：词汇密度、句法、段落节奏和轻重平衡。
- 写作规则：题材约束、人物声音、对话和描写规则。
- 词汇建议：推荐或避免使用的表达。

每本新作品保存已选人格快照，因此后来修改模板不会影响已经创建的小说。

### 润色与编辑引擎

- 流式文本润色和导出。
- 去 AI 化处理，并支持应用回指定章节。
- 章节关键字提取。
- 后台章节调优任务。
- 编辑引擎按人格、结构、风格一致性和语言修订等阶段处理内容，并报告任务进度。

### 密码找回

用户端登录页提供“忘记密码”入口：

1. 输入注册邮箱并获取重置验证码。
2. 输入验证码和新密码。
3. 服务端验证十分钟有效期的验证码后更新 bcrypt 密码哈希。

## 项目结构

```text
MirrorNovel/
├── server/                       # Express + Mongoose 服务端
│   ├── config/                   # 数据库、模型目录、题材、模板和编辑规则
│   ├── middleware/               # JWT 鉴权
│   ├── models/                   # User、Novel、WritingPersona、SysConfig、VerificationCode
│   ├── routes/                   # auth、novel、persona、admin
│   ├── services/                 # AI、上下文、故事状态、编辑、采集辅助
│   └── tests/                    # Node 内置测试
├── client/                       # Vue 用户端 Web
│   └── src/
│       ├── views/                # 生成、续写、书架、润色、资料和认证页面
│       ├── stores/               # Pinia 状态
│       ├── router/               # 用户端路由
│       └── locales/              # 中英文文案
├── admin/                        # Vue 管理端 Web
├── app/                          # uni-app 移动端
├── docs/                         # 补充文档
├── PROJECT_ARCHITECTURE.md       # 当前代码的详细架构与 API 文档
└── LICENSE
```

## 环境要求

- Node.js 18 或更高版本。
- MongoDB 6 或更高版本。
- 与 OpenAI Chat Completions 兼容的模型服务，或可访问的 Ollama 服务。
- 如需使用内容导入辅助功能：Playwright Chromium。

## 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/Aerdelan/MirrorNovel.git
cd MirrorNovel
```

### 2. 安装依赖

```bash
cd server
npm install

cd ../client
npm install

cd ../admin
npm install

cd ../app
npm install
```

### 3. 配置服务端环境变量

复制示例文件：

```bash
cd server
copy .env.example .env
```

在 macOS 或 Linux 中使用：

```bash
cp .env.example .env
```

然后编辑 `server/.env`。至少需要 MongoDB、JWT 和一个可用模型线路。

### 4. 启动 MongoDB

确保 `MONGODB_URI` 对应的 MongoDB 实例正在运行。例如：

```bash
mongod --dbpath /path/to/mongodb-data
```

Windows 使用服务安装时，可在“服务”中启动 MongoDB Server，或按本机 MongoDB 安装方式启动。

### 5. 启动开发服务

分别打开终端运行：

```bash
# 终端 1：服务端，默认 http://localhost:3000
cd server
npm run dev

# 终端 2：用户端，默认 http://localhost:5173
cd client
npm run dev

# 终端 3：管理端，默认 http://localhost:5174
cd admin
npm run dev
```

用户端和管理端通过 Vite 代理把 `/api` 请求转发到 `http://localhost:3000`。

### 6. 可选：安装 Playwright 浏览器

如需使用依赖浏览器的内容导入辅助功能：

```bash
cd server
npx playwright install chromium
```

## 环境变量

以下为安全的最小示例。请不要把真实密钥提交到仓库。

```env
# server/.env
MONGODB_URI=mongodb://127.0.0.1:27017/mirrornovel
PORT=3000

JWT_SECRET=replace_with_a_long_random_secret
JWT_EXPIRES_IN=7d

ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=replace_with_a_strong_password
ADMIN_NICKNAME=管理员

# 默认模型线路的 OpenAI-compatible 配置
AI_API_BASE=https://api.example.com/v1
AI_API_KEY=replace_with_your_api_key
AI_MODEL=your-model-name

# 邮箱验证码，可选；未配置时开发环境会在服务端日志中打印验证码
EMAIL_HOST=smtp.example.com
EMAIL_PORT=465
EMAIL_USERNAME=noreply@example.com
EMAIL_PASSWORD=replace_with_smtp_password
EMAIL_SECURE=true
```

> 启动时若管理员账号不存在，服务端会根据 `ADMIN_EMAIL`、`ADMIN_PASSWORD` 和 `ADMIN_NICKNAME` 自动创建管理员。

## 模型线路配置

### 默认线路

默认线路使用 `AI_API_BASE`、`AI_API_KEY` 和 `AI_MODEL`。若使用不同模型提供商，请确认其接口兼容 Chat Completions 请求格式。

### 多线路环境变量

服务端预置以下线路 ID：

| ID | 环境变量前缀 |
|---|---|
| `normal_1` | `MODEL_NORMAL_1` |
| `normal_2` | `MODEL_NORMAL_2` |
| `advanced_1` | `MODEL_ADVANCED_1` |
| `vip` | `MODEL_VIP` |
| `svip` | `MODEL_SVIP` |

每条线路可设置：

```env
MODEL_NORMAL_1_BASE_URL=https://api.example.com/v1
MODEL_NORMAL_1_API_KEY=replace_with_your_api_key
MODEL_NORMAL_1_MODEL=your-model-name
```

用户可在个人资料中选择默认线路，并针对 `outline`、`writing`、`reasoning`、`polish` 分别指定线路。管理员可在管理端统一维护线路地址、模型名和 API Key。

### Ollama

用户端可配置 Ollama 地址并查询可用模型。常见本机地址为：

```text
http://localhost:11434
```

当 Web 前端与 Ollama 不在同一个设备时，需按 Ollama 文档配置监听地址和 CORS，并限制仅可信网络可访问。

## 使用流程

### 创作一部新小说

1. 访问用户端并登录。
2. 打开“生成”，选择题材与创作模式。
3. 填写主角和世界观。
4. 整本模式下，生成并确认大纲和初始故事蓝图。
5. 选择写作人格和目标字数。
6. 开始生成，页面会实时接收正文和章节状态。
7. 在书架或作品详情中继续、编辑、导出和优化章节。

### 导入续写

1. 打开“续写”。
2. 上传 UTF-8 `.txt` 文件，或粘贴已有正文。
3. 填写续写方向、目标字数和模式。
4. 系统整理导入文本上下文后开始续写。

### 管理模型线路

1. 以管理员账号登录管理端。
2. 打开“模型线路”。
3. 填写接口地址、模型名称和 API Key。
4. 保存后，服务端会更新模型目录配置。

## API 概览

完整接口表、数据模型和数据流请阅读 [PROJECT_ARCHITECTURE.md](PROJECT_ARCHITECTURE.md)。

### 认证

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/register` | 注册 |
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/send-code` | 注册验证码 |
| POST | `/api/auth/send-reset-code` | 密码重置验证码 |
| POST | `/api/auth/reset-password` | 重置密码 |
| GET/PUT | `/api/auth/model-config` | 获取/保存用户模型配置 |

### 小说

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/novel/types` | 基础类型列表 |
| GET | `/api/novel/types/full` | 完整分类数据 |
| POST | `/api/novel/generate-outline` | 生成大纲 |
| POST | `/api/novel/generate-blueprint` | 生成故事蓝图 |
| POST | `/api/novel/generate` | SSE 小说生成 |
| POST | `/api/novel/continue/:novelId` | SSE 续写 |
| POST | `/api/novel/continue-import` | 导入续写 |
| GET | `/api/novel/bookshelf` | 获取书架 |
| POST | `/api/novel/polish` | SSE 文本润色 |

### 写作人格与管理端

| 前缀 | 说明 |
|---|---|
| `/api/persona` | 写作人格的列表、新建、编辑、克隆和 AI 生成 |
| `/api/admin/users` | 管理用户 |
| `/api/admin/models` | 管理模型线路 |
| `/api/admin/dashboard` | 管理概览 |

## 测试与构建

```bash
# 服务端测试
cd server
npm test

# 用户端生产构建
cd ../client
npm run build

# 管理端生产构建
cd ../admin
npm run build

# uni-app H5 构建
cd ../app
npm run build:h5
```

服务端测试覆盖提示词与模型路由、故事状态、上下文记忆、生成 SSE、续写、暂停和章节重复保护等核心行为。

## 部署建议

```text
浏览器 / 移动端
        │
        ├── 用户端静态资源
        ├── 管理端静态资源
        │
        ▼
Express API 服务
        │
        ├── OpenAI-compatible 模型服务 / Ollama
        ├── SMTP 邮箱服务
        └── MongoDB
```

生产环境建议：

- 使用 `npm run build` 生成的静态资源，并通过 Nginx、Caddy 或同类服务托管。
- 使用 systemd、PM2、Docker Compose 或平台进程管理器守护 API 服务。
- MongoDB 只绑定受信网络，不暴露给公网。
- 使用随机且独立的 JWT 密钥、管理员密码、SMTP 密码和模型 API Key。
- 设置 HTTPS、反向代理超时和日志轮转。
- 定期备份 MongoDB 数据，并在升级前验证备份可恢复。

## 安全说明

- 密码使用 bcrypt 哈希存储。
- API 鉴权使用 JWT。
- 重置验证码带过期时间；请求不存在邮箱时不暴露账户存在性。
- 请在生产环境增加登录与验证码频率限制、审计日志和适当的网络访问控制。
- 不要提交 `.env`、数据库文件、模型密钥、邮箱密码或任何生产凭据。
- AI 输出仅作为创作辅助，发布前请自行审核内容、版权、隐私与适用法律要求。

## 已知限制

- 长篇生成依赖模型上下文能力、网络稳定性和模型输出质量。
- 外部内容导入受站点规则、网络和浏览器环境影响。
- 模型提供商的模型名、上下文长度和请求格式存在差异，需要在模型线路中正确配置。
- 本地开发时，后端依赖可用的 MongoDB；数据库未运行会导致 API 服务无法启动。

## 开源协议

本项目采用仓库中的 [LICENSE](LICENSE) 所声明的协议。使用、修改或分发前请阅读协议全文，并遵守所使用模型服务、第三方库和内容来源的相应条款。

---

<a id="readme-en"></a>

# MirrorNovel

> An AI-assisted platform for long-form novel generation, continuation, polishing, and story continuity management.

MirrorNovel combines genre selection, writing personas, outlines, story blueprints, chapter plans, and persistent context in one workflow. It includes a Vue user web app, a Vue admin web app, a uni-app client, and an Express API.

## Highlights

- Generate a full novel or a single chapter, including light-novel presets.
- Create and confirm outlines and story blueprints before full-book generation.
- Persist chapter summaries, facts, plot hooks, character state, and tension history for continuation.
- Manage system, user-authored, and AI-generated writing personas.
- Import a TXT manuscript and continue writing from its existing story context.
- Stream polishing, de-AI rewriting, chapter optimization, and editorial workflows.
- Configure default and task-specific model routes for outline, writing, reasoning, and polishing.
- Use web, admin, and uni-app clients against the same Express and MongoDB backend.

## Quick Start

```bash
git clone https://github.com/Aerdelan/MirrorNovel.git
cd MirrorNovel

cd server && npm install
cd ../client && npm install
cd ../admin && npm install
cd ../app && npm install
```

Create `server/.env` from the example, configure MongoDB, JWT, and at least one model route, then run:

```bash
# API: http://localhost:3000
cd server && npm run dev

# User web: http://localhost:5173
cd client && npm run dev

# Admin web: http://localhost:5174
cd admin && npm run dev
```

The Vite apps proxy `/api` requests to `http://localhost:3000`. MongoDB must be running before the API can start.

## Configuration

```env
MONGODB_URI=mongodb://127.0.0.1:27017/mirrornovel
PORT=3000
JWT_SECRET=replace_with_a_long_random_secret
JWT_EXPIRES_IN=7d
AI_API_BASE=https://api.example.com/v1
AI_API_KEY=replace_with_your_api_key
AI_MODEL=your-model-name
```

Use the `MODEL_<ROUTE>_BASE_URL`, `MODEL_<ROUTE>_API_KEY`, and `MODEL_<ROUTE>_MODEL` variables for route-specific overrides. The available route IDs are `normal_1`, `normal_2`, `advanced_1`, `vip`, and `svip`.

## Build and Test

```bash
cd server && npm test
cd ../client && npm run build
cd ../admin && npm run build
cd ../app && npm run build:h5
```

For the full architecture, route inventory, data models, and workflow diagrams, see [PROJECT_ARCHITECTURE.md](PROJECT_ARCHITECTURE.md).

## Security

Keep `.env`, database files, API keys, SMTP credentials, and production passwords out of source control. Use HTTPS, restrict MongoDB network access, and add request rate limiting before production use.

## License

See [LICENSE](LICENSE).

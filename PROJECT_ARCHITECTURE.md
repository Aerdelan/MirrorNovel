# MirrorNovel — 项目逻辑关系文档

> 生成于 2026-05-28
> 项目路径: d:/fanqiexiaoshuo

---

## 一、项目全景

MirrorNovel（镜象小说）是一个 **AI 小说生成平台**，核心能力是通过大语言模型（LLM）自动化创作小说，并支持风格模仿、续写、润色等辅助功能。

### 技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 前端（用户端） | Vue 3 + Pinia + Vue Router | 面向普通用户的小说创作界面 |
| 前端（管理端） | Vue 3 + Pinia + Vue Router | 管理员后台，运营管理 |
| 后端 | Express + Mongoose | RESTful API 服务 |
| 数据库 | MongoDB (Docker) | 数据持久化 |
| AI 引擎 | 兼容 Ollama / 云 API | 文本生成、分析、润色 |
| 爬虫 | Playwright + HTTP | 番茄小说数据采集 |

---

## 二、模块依赖关系图

```
┌─────────────────────────────────────────────────────────────────────┐
│                          前端 (client)                               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│  │登录/注册  │  │生成小说   │  │续写小说   │  │润色      │            │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘            │
│       │              │              │              │                 │
│  ┌────▼──────────────▼──────────────▼──────────────▼─────┐          │
│  │                  stores (Pinia)                        │          │
│  │     auth.js  │  novel.js  │  reference.js             │          │
│  └────────────────────────┬──────────────────────────────┘          │
│                           │ HTTP (axios)                            │
└───────────────────────────┼──────────────────────────────────────────┘
                            │
┌───────────────────────────┼──────────────────────────────────────────┐
│                   后端 (server)                                     │
│                           ▼                                         │
│  ┌───────────────────────────────────────────────────────┐          │
│  │                   routes/                               │          │
│  │  auth.js  │  novel.js  │  reference.js  │  admin.js    │          │
│  └────┬──────────┬──────────────┬──────────────┬─────────┘          │
│       │          │              │              │                    │
│       ▼          ▼              ▼              ▼                    │
│  ┌──────┐ ┌──────────┐ ┌──────────────┐ ┌──────────┐               │
│  │auth.js│ │aiService │ │fanqieScraper │ │User/Novel│               │
│  │middle-│ │.js       │ │.js          │ │Model     │               │
│  │ware   │ │          │ │playwright   │ └──────────┘               │
│  └──────┘ │          │ │Proxy.js     │        │                   │
│           │novel     │ │fontDecoder  │        ▼                   │
│           │Context.js│ │.js          │  ┌──────────┐               │
│           │writing   │ └──────────────┘  │ MongoDB  │               │
│           │Agent.js  │                   │ (Docker) │               │
│           │chapter   │                   └──────────┘               │
│           │Toolchain │                                              │
│           │.js       │                                              │
│           └──────────┘                                              │
│                                                                     │
│  ┌───────────────────────────────────────────────────────┐          │
│  │                    config/                              │          │
│  │  novelTypes.js → novelTypeData.js → novelTemplates.js  │          │
│  │  deslop.js (去AI词汇表) → db.js                       │          │
│  └───────────────────────────────────────────────────────┘          │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 三、功能模块评估

### 3.1 用户认证系统 (`routes/auth.js` + `middleware/auth.js`)

| 维度 | 评估 |
|---|---|
| **功能** | 注册/登录/JWT 鉴权/Token 配额/签到/邀请码/模型配置 |
| **完整性** | ⭐⭐⭐⭐ 功能完善，覆盖了注册到使用的完整链路 |
| **安全性** | ⭐⭐⭐ 密码 bcrypt 加密 ✅，JWT 鉴权 ✅，但缺少登录频率限制、IP 封禁等 |
| **可维护性** | ⭐⭐⭐ 代码集中在 auth.js (300+ 行)，可拆分为 auth/checkin/invite 子路由 |

### 3.2 小说生成 (`routes/novel.js` + `services/aiService.js`)

| 维度 | 评估 |
|---|---|
| **功能** | 整本/单章生成、大纲生成、续写、导入续写、润色、去AI味 |
| **完整性** | ⭐⭐⭐⭐⭐ 最核心的功能，链路完整 |
| **性能** | ⭐⭐⭐ 流式 SSE 输出 ✅，SSR 无，大文件生成可能超时 |
| **问题** | `novel.js` 单文件 1240+ 行，多处重复代码（generateOneChapter 在两个路由中重复定义）|

### 3.3 蒸馏系统 (`routes/reference.js` + `models/ReferenceNovel.js`)

| 维度 | 评估 |
|---|---|
| **功能** | 上传 TXT 蒸馏、番茄小说导入蒸馏、风格提取、分类匹配、生成时注入 |
| **完整性** | ⭐⭐⭐⭐ 功能链路完整 |
| **问题** | AI 分析只取前 20K 字（已修复为 400K），多次导入同一本书无去重（已修复），匹配仅按名称精确匹配 |

### 3.4 番茄小说爬虫 (`services/fanqieScraper.js` + `playwrightProxy.js`)

| 维度 | 评估 |
|---|---|
| **功能** | 获取书籍信息、下载章节内容、字体反爬解码 |
| **完整性** | ⭐⭐⭐ 核心功能可用，但依赖外部服务稳定性 |
| **问题** | Playwright 浏览器实例管理复杂，字体反爬解码成功率不稳定，已加重试机制 |

### 3.5 润色系统 (`routes/novel.js` 中的 `/polish` 路由)

| 维度 | 评估 |
|---|---|
| **功能** | 文本润色 + 去AI味处理 |
| **完整性** | ⭐⭐⭐⭐ 支持自定义润色方案，流式输出 |

### 3.6 管理后台 (`admin/`)

| 维度 | 评估 |
|---|---|
| **功能** | 数据大屏、用户管理、小说管理、蒸馏管理、模型配置、类型模板管理 |
| **完整性** | ⭐⭐⭐⭐ Tab 式布局，功能覆盖全面 |
| **问题** | 列表页分页用简单 skip/limit，大数量时性能劣化；无批量操作日志 |

### 3.7 国际化 (`composables/useI18n.js`)

| 维度 | 评估 |
|---|---|
| **功能** | 中英文切换、类型/标签名称映射 |
| **完整性** | ⭐⭐⭐⭐ 覆盖全页面 |
| **问题** | 翻译文件手动维护，容易遗漏新增的文本 |

### 3.8 保活与部署 (`deploy.sh` + `keepalive.sh` + `scripts/webhook.js`)

| 维度 | 评估 |
|---|---|
| **功能** | Git Webhook 自动部署、PM2 进程保活、数据库备份 |
| **完整性** | ⭐⭐⭐⭐ 三层防护（PM2 + crontab + systemd） |
| **问题** | deploy.sh 和 webhook.js 不在 git 中，需手动同步 |

---

## 四、数据流关键链路

### 4.1 小说生成主链路

```
用户选择类型/填写设定
    │
    ▼
GeneratePage.vue ── POST /novel/generate-outline → AI 生成大纲
    │                                                    │
    │                                         大纲弹窗供用户编辑确认
    │                                                    │
    ▼                                                    ▼
POST /novel/generate ──→ 路由验证 Token 余额
    │
    ▼
buildSystemPrompt(novelTypeId, gender) → 基础系统提示
    │
    ▼
匹配参考风格: ReferenceNovel.find(referenceIds) → 注入参考风格
    │
    ▼
匹配类型模板: matchTemplates(worldSetting, novelTypeId)
    │
    ▼
SSE 流式输出大纲 → 大纲确认 → 流式输出章节
    │
    ▼
每章生成完毕 → processChapter() 工具链后处理
    │
    ▼
存入 MongoDB → deductTokens() 扣费
```

### 4.2 蒸馏主链路

```
上传 .txt / 番茄 Book ID 导入
    │
    ▼
文件校验 → 去重检查 (title + mainCategory)
    │
    ▼
extractStyleProfile(fullText) → AI 分析前 400K 字
    │
    ▼
parseStyleOutput() → 解析为结构化字段
    │
    ▼
存入 ReferenceNovel 集合
    │
    ▼
用户生成小说时按 mainCategory 自动匹配
    │
    ▼
注入 systemPrompt → AI 模仿风格创作
```

### 4.3 续写主链路

```
用户选择续写/导入续写
    │
    ▼
ContinuePage.vue / BookshelfPage.vue
    │
    ▼
POST /novel/continue/:id → 加载已有小说
    │
    ▼
buildAugmentedContext(chapters) → RAG 风格上下文
    │  ├─ 近期章节保留详情 (头500字 + 尾300字)
    │  ├─ 前置章节压缩为摘要
    │  ├─ 追踪活跃角色
    │  └─ 提取未回收伏笔
    │
    ▼
agentGenerateChapter() → Agent 循环
    │  ├─ PLAN: planChapter() → 章节计划
    │  ├─ WRITE: streamGenerate() → 流式写作
    │  ├─ REVIEW: reviewChapter() → 质量审查
    │  └─ REVISE: reviseChapter() → 自动修订
    │
    ▼
processChapter() → 去AI味 + 标点修正
    │
    ▼
存入 MongoDB
```

---

## 五、优化建议（按优先级排序）

### P0 — 安全问题（已部分触发）

| 问题 | 建议 | 状态 |
|---|---|---|
| MongoDB 公网暴露 | 已关闭，仅 127.0.0.1 | ✅ 已修复 |
| 密码强度 | 已改为随机强密码 | ✅ 已修复 |
| 无登录频率限制 | 添加 rate-limit 中间件 | ❌ 待实施 |
| JWT 不过期 | 添加 refresh token 机制 | ❌ 待实施 |

### P1 — 架构问题

| 问题 | 建议 |
|---|---|
| **生产环境用 Vite dev 模式** | 改为 `vite build` 构建静态文件，nginx 或 PM2 `serve` 部署 |
| **novel.js 1240+ 行** | 拆分为多个文件：`generate.js`、`continue.js`、`polish.js`、`utils.js` |
| **generateOneChapter 重复定义** | 抽取为公共函数，两个路由共用 |
| **无日志系统** | 引入 winston/pino，替代 console.log |
| **无 API 文档** | 使用 swagger/jsdoc 生成文档 |

### P2 — 性能问题

| 问题 | 建议 |
|---|---|
| **Vite 热重载浪费内存** | `vite build` + nginx 静态托管，内存从 90MB→10MB |
| **列表分页用 skip/limit** | 大数据量时改用 `_id` 游标分页 |
| **无缓存** | 小说类型/模板数据可缓存到内存，无需每次都读文件 |
| **Token 计算不准确** | 使用 tiktoken 等更准确的分词器 |

### P3 — 功能增强

| 功能 | 建议 |
|---|---|
| **蒸馏去重** | ✅ 已添加 |
| **全本蒸馏** | ✅ 已增加至 400K 字 |
| **模板多样性** | ✅ 已改为随机变体组合 |
| **Agent 续写** | ✅ 已添加 |
| **RAG 上下文** | ✅ 已替代 distillChapters |
| **工具链后处理** | ✅ 已添加去AI味 + 标点修正 |
| **保活策略** | ✅ 已添加 |

### P4 — 代码质量

| 问题 | 建议 |
|---|---|
| 无 TypeScript | 长期可迁移，短期不必须 |
| 无单元测试 | 核心函数（parseStyleOutput、matchTemplates）可加简单测试 |
| 无 ESLint 配置 | 添加统一代码规范 |
| 错误处理不一致 | 部分 try-catch 仅 console.error，应返回统一错误格式 |

---

## 六、部署架构

```
                      ┌─────────────────┐
                      │   用户浏览器      │
                      │   client:5173   │
                      │   admin:5174    │
                      └────────┬────────┘
                               │ HTTP
                               ▼
┌──────────────────────────────────────────────────┐
│              腾讯云 Lighthouse (硅谷)               │
│                                                    │
│  PM2 管理 (进程守护 + 开机自启)                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────┐ │
│  │xiaoshuo- │ │xiaoshuo- │ │xiaoshuo- │ │deploy │ │
│  │server    │ │client    │ │admin     │ │webhook│ │
│  │:3001     │ │:5173     │ │:5174     │ │:3457  │ │
│  └────┬─────┘ └──────────┘ └──────────┘ └───────┘ │
│       │                                            │
│       ▼                                            │
│  ┌──────────┐                                      │
│  │ MongoDB  │                                      │
│  │ Docker   │                                      │
│  │ :27017   │                                      │
│  │ (本地)   │                                      │
│  └──────────┘                                      │
│                                                    │
│  保活: crontab (每分钟) + systemd (开机)            │
│  备份: deploy.sh 部署前自动 mongodump               │
└────────────────────────────────────────────────────┘
```

---

## 七、完整的 API 路由表

### 认证 (`/api/auth`)

| 方法 | 路径 | 功能 | 鉴权 |
|---|---|---|---|
| POST | /register | 用户注册 | - |
| POST | /login | 用户登录 | - |
| GET | /profile | 获取用户信息 | auth |
| PUT | /profile | 更新用户信息 | auth |
| POST | /checkin | 每日签到 | auth |
| GET | /checkin-status | 签到状态查询 | auth |
| PUT | /model-config | 更新用户模型配置 | auth |
| GET | /model-config | 获取模型配置 | auth |
| POST | /send-code | 发送邮箱验证码 | - |
| GET | /invite-info | 获取邀请信息 | auth |

### 小说 (`/api/novel`)

| 方法 | 路径 | 功能 | 鉴权 |
|---|---|---|---|
| GET | /types | 获取小说类型列表 | - |
| POST | /generate-outline | 生成大纲 | auth |
| POST | /generate | 创建并生成小说 (SSE) | auth |
| POST | /continue/:id | 继续生成 (SSE) | auth |
| POST | /continue-import | 导入续写 (SSE) | auth |
| GET | /bookshelf | 获取用户书架 | auth |
| POST | /export | 导出小说 (ZIP) | auth |
| GET | /:id | 获取小说详情 | auth |
| DELETE | /:id | 删除小说 | auth |
| POST | /pause/:id | 暂停生成 | auth |
| PUT | /:id/outline | 更新大纲 | auth |
| PUT | /:id/chapter/:num | 编辑章节 | auth |
| DELETE | /:id/chapter/:num | 删除章节 | auth |
| POST | /:id/continue-chapter/:num | 继续生成指定章节 (SSE) | auth |
| GET | /types/map | 类型图标映射 | - |
| POST | /deslop | 去AI味处理 | auth |
| POST | /polish | 润色 (SSE) | auth |
| POST | /match-templates | 匹配类型模板 | auth |

### 参考小说 (`/api/reference`)

| 方法 | 路径 | 功能 | 鉴权 |
|---|---|---|---|
| GET | /categories | 获取分类数据 | - |
| POST | /upload | 上传 TXT 蒸馏 | admin |
| GET | /list | 获取蒸馏列表 | admin |
| GET | /list-by-type | 按类型筛选 | auth |
| GET | /fanqie-preview | 番茄小说预览 | admin |
| POST | /fanqie-cookie | 保存番茄 Cookie | admin |
| GET | /fanqie-cookie-status | Cookie 状态 | admin |
| DELETE | /fanqie-cookie | 清除 Cookie | admin |
| GET | /fanqie-download | 下载番茄小说 | admin |
| POST | /fanqie-import | 导入番茄小说并蒸馏 | admin |
| GET | /:id | 获取蒸馏详情 | admin |
| DELETE | /:id | 删除蒸馏记录 | admin |

### 管理后台 (`/api/admin`)

| 方法 | 路径 | 功能 | 鉴权 |
|---|---|---|---|
| GET | /dashboard | 数据大盘 | admin |
| GET | /users | 用户列表 | admin |
| PUT | /users/:id | 编辑用户 | admin |
| GET | /users/simple | 简易用户列表 | admin |
| GET | /users/:id/invited-users | 查看邀请用户 | admin |
| POST | /users/:id/group-reward | 进群赠送奖励 | admin |
| GET | /novels | 小说列表 | admin |
| GET | /distillations | 蒸馏记录列表 | admin |
| GET | /distillations/:id | 蒸馏详情 | admin |
| PUT | /distillations/:id | 编辑蒸馏记录 | admin |
| DELETE | /distillations/:id | 删除蒸馏记录 | admin |
| GET | /distillations/:id/export | 导出蒸馏记录 | admin |
| POST | /distillations/export-batch | 批量导出 | admin |
| GET | /models | 获取模型配置 | admin |
| PUT | /models | 保存模型配置 | admin |
| POST | /restart | 重启服务 | admin |
| GET | /templates | 获取类型模板 | admin |
| PUT | /templates | 保存类型模板 | admin |

---

## 八、数据库集合

| 集合 | 对应 Model | 核心字段 |
|---|---|---|
| **users** | User | email, password(bcrypt), nickname, role, tokens, checkin, inviteCode, modelConfig |
| **novels** | Novel | userId, title, chapters[], status, currentWordCount, targetWordCount, outline, generationContext |
| **referencenovels** | ReferenceNovel | userId, title, novelType, styleProfile, keyExcerpts, vocabularyBank, qualityScore, downloadStats |
| **sysconfigs** | SysConfig | key, value (通用配置 KV 存储) |
| **verificationcodes** | VerificationCode | email, code, type, expiresAt |

---

## 九、总结

| 指标 | 数据 |
|---|---|
| 后端文件数 | 22 个 |
| 前端文件数 (client) | 16 个 |
| 前端文件数 (admin) | 5 个 |
| API 端点总数 | 42 个 |
| 数据库集合 | 5 个 |
| 核心功能 | 生成 / 续写 / 润色 / 蒸馏 / 番茄导入 |
| 部署模式 | PM2 + Vite Dev + Docker MongoDB |
| 安全态势 | 已修复 MongoDB 公网暴露，仍有 rate-limit / JWT 刷新待完善 |

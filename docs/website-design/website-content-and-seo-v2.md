# MirrorNovel 官网：第二版文案与 SEO 实施规格

> 首页布局与文案已由 `homepage-simplified-v3.md` 精简替代；本文件中的独立页面规划与技术 SEO 要求继续有效。

状态：设计与实施规格，尚未开发、部署或提交搜索引擎。保留首页样式图第一版；第二版补充模型获取方式与内容入口。正式域名尚未指定，站点绝对 URL 待部署配置。

## 1. 定位与模型说明

首页产品定位：**免费开源的 AI 小说写作软件**。

主视觉标题沿用：**让故事自由生长，让创作不设限。**

首页简介：MirrorNovel 是面向长篇小说、轻小说与连续短剧的 AI 创作工作台，支持故事蓝图、章节续写、风格模板、润色修订与作品导出。

模型区标题：**用自己的模型，或联系作者获取模型服务。**

两张并列卡片：

- **接入个人模型**：填写自己的模型接口地址、API Key 与模型名称，接入兼容 API，或连接后端可访问的 Ollama 服务。大纲、正文、推理、润色可分别选择线路与模型。按钮：查看模型配置教程。
- **联系作者提供模型**：没有现成模型接口，也可以联系作者，咨询可用模型、接入方式与使用安排。按钮：查看联系作者方式。使用站内联系区，展示 QQ 交流群 **1019601998**、复制群号按钮及入群咨询说明；群号不冒充作者个人 QQ。

费用说明：**软件免费下载使用；个人接口及作者提供模型的可用性、额度与费用，以对应渠道说明为准。** 不推定作者模型免费，不编造价格或额度。

环境说明：桌面端需连接后端。现有安装包不包含完整业务后端、数据库或模型权重；不宣传安装后离线一体运行。

首页 FAQ 至少包含：

1. 软件免费，具体指什么？软件免费下载使用；模型与后端服务的费用由所选渠道决定。
2. 可以使用自己的模型吗？可以配置兼容模型接口，或使用后端可访问的 Ollama 服务；不同服务的适配情况需测试连接。
3. 没有模型接口怎么办？可以联系作者咨询模型服务，在 QQ 交流群 1019601998 中说明需求，接入方式与使用条件以作者说明为准。
4. 桌面端能完全离线使用吗？当前安装包需要后端及可用模型线路，不是离线一体包。
5. 已有小说能导入续写吗？续写入口支持 TXT 上传或粘贴正文；参考库的 EPUB/ZIP 支持属于另一套流程，不混淆说明。

## 2. 页面与搜索意图

以下为规划页面，不把未完成页面放进 sitemap 或导航。每个页面须有独立、实用的内容及可抓取 URL；不批量复制模板制造关键词页面。

| 路径 | 页面主题与拟定标题 | 主要内容 |
| --- | --- | --- |
| `/` | MirrorNovel - 免费开源 AI 小说写作软件与桌面创作工作台 | 定位、痛点、真实功能、模型两种选择、适用人群、下载、FAQ |
| `/download/` | MirrorNovel Windows 桌面版下载与安装指南 | 安装包直链、系统架构、当前附件版本、安装步骤、后端与模型准备、版本记录 |
| `/features/long-form-writing/` | AI 长篇小说创作：故事蓝图、章节计划与连续性管理 | 实际蓝图层级、跨章衔接方式、暂停恢复及作者检查示例 |
| `/features/novel-continuation/` | AI 小说续写：导入已有正文并继续创作 | TXT/粘贴导入、续写方向、上下文准备、完整操作示例 |
| `/features/writing-style/` | AI 小说文风调整与润色：写作人格和风格模板 | 模板创建与复用、差异检查、修订示例；不承诺检测通过率 |
| `/features/screenplay/` | AI 短剧剧本创作与小说改编工作台 | 原创/改编、分集分场、编辑与导出；不宣称生成完整视频 |
| `/docs/model-setup/` | MirrorNovel 模型配置教程：个人 API、Ollama 与作者模型 | 两种模型获取方式、线路配置、连接测试、任务模型分配、常见错误 |
| `/docs/self-hosting/` | MirrorNovel 自行部署与后端连接指南 | 按当前仓库验证过的部署步骤、桌面后端切换、更新与备份 |
| `/contact/` | 联系 MirrorNovel 作者与社区支持 | 模型咨询、入群方式、问题反馈、源码与 Issues |

站内导航：功能亮点、模型接入、使用指南、常见问题、GitHub、免费下载。

首页痛点卡链接到对应功能页；功能页链接到配置教程和下载页；教程提供返回相关功能及下载的上下文链接。使用有含义的链接文字。

## 3. 首页 SEO 文案

Title：`MirrorNovel - 免费开源 AI 小说写作软件与桌面创作工作台`

Description：`MirrorNovel 是免费开源的 AI 小说写作桌面工具，支持长篇故事蓝图、小说续写、风格模板、润色修订与短剧改编。可接入个人模型，也可联系作者获取模型服务，支持自建后端，免费下载 Windows 版。`

首页使用一个清晰的主 H1，按视觉稿设置主标题，附近以可见 HTML 文字写明“免费开源的 AI 小说写作软件”。其余主要区块使用 H2，卡片标题使用 H3。Title、description 与正文自然对应，不堆砌重复关键词，不依赖 meta keywords。

## 4. 技术实施

- 官网独立于需登录的创作工作台，优先静态生成或预渲染。内容、链接、FAQ 和核心下载按钮存在于初始 HTML 中，禁用 JavaScript 仍可阅读、跳转与下载。图片不承载唯一正文。
- 每个内容页独立 title、description、canonical、社交分享标题/摘要/图片；全站配置 `lang="zh-CN"`、favicon、移动端 viewport。只在提供真实译文后增加 hreflang。
- 正式域名统一 HTTPS、唯一主机名与路径规则，用永久重定向合并重复入口。canonical 与 sitemap 来源于同一站点配置；禁止残留示例域名。失效地址返回真实 404；已迁移内容跳转至对应页面。
- 发布环境提供 robots.txt 与 sitemap.xml，只列可索引、返回 200 的规范内容 URL。lastmod 使用内容的真实更新时间。预览环境使用 noindex，并在上线前检查移除；robots.txt 不作为保密或撤索引机制。
- 用 JSON-LD 描述真实的 WebSite、SoftwareApplication 和内页面包屑。软件价格 0 仅表示软件本身；模型费用在可见正文明确说明。不编造评分、评论、荣誉、下载量或模型品牌合作。不承诺 FAQ 富结果。
- 字体优先系统中文字体，若用网络字体则自托管并控制子集体积，避免依赖海外字体服务。首屏不用视频作背景；产品截图提供 WebP/AVIF、宽高及适当 alt，首屏主图优先加载，后续图片延迟加载。图片与按钮预留空间，减少布局位移。
- 部署时配置压缩、带内容哈希的静态资源缓存及 CDN。主下载链接直接指向 GitHub 的实际 exe 附件，不依赖客户端先请求 GitHub API 后才显示链接。

## 5. 下载与版本维护

本次已确认的最新版标记对应 v1.10.3，附件名为 `MirrorNovel.Setup.1.1.4.exe`；发布标签与安装包版本不一致时分别展示，避免把二者当成同一个版本号。

安装包直链：

https://github.com/Aerdelan/MirrorNovel/releases/download/v1.10.3/MirrorNovel.Setup.1.1.4.exe

版本记录：

https://github.com/Aerdelan/MirrorNovel/releases

所有主下载按钮保持真实 `<a href="安装包直链">`。跨域下载由 GitHub 响应触发，不把 HTML download 属性当作保证。部署时再次核对 release 与 exe 附件；建议在构建阶段读取发布信息并把核实后的版本和链接写入静态页面，失败时保留已验证版本。不在用户访问时强依赖 GitHub API。新增下载埋点时不阻塞跳转。

## 6. 验收与上线后观察

以下均为待实施与验收目标，不是已有成绩：

- 抽查每个页面的原始 HTML：无需执行 JavaScript 即有主要文字、站内链接及下载链接。
- 检查状态码、重定向、唯一元信息、canonical、robots、sitemap、站内死链及结构化数据一致性。
- 以移动端与桌面端分别检查页面；自动化 Lighthouse SEO 目标 100、Performance 目标 90 以上，结合实际访问地区与网络复测。评分只是工程检查，不等于搜索排名。
- 真实流量足够后按第 75 百分位观察 Core Web Vitals：LCP ≤ 2.5 秒、INP ≤ 200 毫秒、CLS ≤ 0.1。上线前实验室数据不能替代真实用户 INP。
- 正式域名部署后，验证 Google Search Console、Bing Webmaster Tools 与百度搜索资源平台的站点所有权；使用账户实际开放的 sitemap/URL 提交能力。Bing 可按需通过 IndexNow 通知内容变更。没有域名或验证权限前，不宣称已经提交或收录。
- 观察索引覆盖、搜索展现、点击率、自然搜索下载点击及模型咨询入口点击；只按真实数据改进标题和内容。若启用统计，另行确认采集方案和隐私说明，不默认向第三方发送访客数据。
- 持续更新有实用价值的配置、创作与故障排查教程；版本变更同步到下载页。技术优化、提交与结构化数据都不保证收录、排名或自然流量。

## 7. 官方依据

- Google SEO 入门：https://developers.google.com/search/docs/fundamentals/seo-starter-guide
- Google JavaScript SEO：https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics
- Google Core Web Vitals：https://developers.google.com/search/docs/appearance/core-web-vitals
- Bing IndexNow：https://www.bing.com/indexnow
- Bing URL 提交：https://www.bing.com/webmasters/help/?topicid=62f2860b
- 百度搜索资源平台：https://ziyuan.baidu.com/site/index

本规格依据官方文档制定；正式构建时根据实际域名、框架、内容与站长平台权限验收。

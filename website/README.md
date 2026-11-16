# MirrorNovel 桌面端官网

独立的静态官网，沿用确认后的第四版布局：简洁文案、大幅真实软件截图。联系作者入口统一前往 **https://github.com/Aerdelan**。

## 本地运行

需要 Node.js 22 或更高版本；无 npm 第三方依赖，不需要安装运行库。

```powershell
cd website
npm run build
npm run check
npm run preview
```

打开命令打印的 `http://127.0.0.1:4179/`。停止预览使用 Ctrl+C。预览服务仅监听本机，并发送 `X-Robots-Tag: noindex`；正式构建不会继承这个预览响应头。

## 内容与目录

- `src/home.html`：已确认的简洁首页。
- `src/content.mjs`：下载、功能与教程正文；当前包含首页在内共 10 个内容页面。
- `src/site.css`、`src/content.css`：首页、文章页与响应式布局。
- `src/site.js`：截图切换、键盘操作和原图放大；正文与下载不依赖 JavaScript。
- `public/assets/`：真实截图原图、响应式 WebP、品牌图标。
- `site.config.json`：正式域名、作者链接、版本与安装包直链。
- `scripts/build.mjs`：生成独立 HTML、元信息、JSON-LD、sitemap、robots、404 与缓存头配置。
- `tests/site.test.mjs`：元信息、规范 URL、站点地图、死链、作者入口、下载和资源预算检查。
- `dist/`：构建产物，部署这个目录；不提交到业务仓库。

原始截图来自项目 `promo-video/frames/` 和 `docs/screenshots/`；未使用生成式模型重绘界面。展示资产做了缩放与 WebP 压缩，原 PNG 保留供放大查看。替换截图后可使用 Python + Pillow 运行 `python scripts/optimize-assets.py` 重新生成优化图，再构建。

## 更新安装包

```powershell
npm run update:release
npm run build
npm run check
```

更新脚本从 GitHub 的最新 Release 页面找出 Windows 安装包并验证下载响应；识别失败不会覆盖现有配置。发布标签与 exe 版本分别记录。用户点击下载时直接访问已写入 HTML 的 exe 地址，不需要请求 GitHub API。

## 正式部署和域名

可以把 `dist/` 放到支持静态目录的服务器或静态托管平台。服务端须把无匹配地址返回为真实 404，而不是统一重写为首页。目录 URL 采用尾斜杠格式，站点应统一 HTTPS 和规范主机名。

若使用自有域名，先修改 `site.config.json` 的 `origin`，或在构建时覆盖：

```powershell
$env:SITE_URL = 'https://你的实际域名'
npm run build
npm run check
```

`SITE_URL` 必须是实际 HTTP(S) 域名，不含子路径。`canonical`、Open Graph、JSON-LD 与 sitemap 会统一跟随此值，不要只替换首页里的一个 URL。发布到平台提供的默认域名时，可以保留当前配置。

缓存与常见安全响应头写在 `_headers`；托管平台若不识别该文件，请在服务器配置同样规则。无路径匹配时的 `_redirects` 也需要平台支持；本地预览服务已经实现真实 404。站点没有集成统计、第三方字体或访客追踪脚本。

## SEO 实现与上线验收

已实现原始 HTML 内容、独立 title/description、规范 URL、WebSite/WebPage/SoftwareApplication/面包屑 JSON-LD、社交分享元信息、robots、sitemap、语义标题、图片 alt/尺寸、首图优先加载与其余图片延迟加载。没有虚构评价或评分；免费价格指软件本身。

网站在 Sites 中首次创建时默认是私有。私有访问期间搜索引擎无法抓取；公开官网需要在托管平台设置公开访问或部署到自有公开服务器，并按正式域名重新检查访问规则。

上线后需要由拥有站点权限的账号验证百度搜索资源平台、Google Search Console 和 Bing Webmaster Tools，提交实际域名下的 sitemap。IndexNow 也应在具备实际域名和验证密钥后按需接入；本项目没有预置虚构密钥或宣称已提交收录。

自动检查通过不等于已经获得搜索排名。真实 Core Web Vitals、搜索展现和点击率需在公开站点有足够访问数据后评估；本次没有把实验室数据冒充真实用户性能或声称 Lighthouse 满分。

## 发布记录

Sites 项目标识保存在 `.openai/hosting.json`。发布工具使用独立源码副本，避免把当前业务仓库的整个源码发送到官网托管。部署包只包含官网静态构建及对应托管清单。

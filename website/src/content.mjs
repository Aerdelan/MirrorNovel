export const pages = [
  {
    path: '/download/', section: '下载与安装', title: 'MirrorNovel Windows 桌面版下载与安装指南',
    description: '免费下载 MirrorNovel Windows 64 位桌面安装包。查看安装步骤、后端与模型配置要求，以及首次创作前的准备事项。',
    intro: '下载免费的桌面工作台，再连接你选择的后端与模型。',
    body: `<section><h2>下载 Windows 64 位安装包</h2><div class="download-panel">{{download}}<p>安装包版本 {{version}} · 发布标签 {{tag}} · Windows 64 位</p><code>{{filename}}</code></div><p>主按钮直接下载 GitHub Release 中的 exe 附件。需要查看其他版本，请打开<a href="{{repository}}/releases" target="_blank" rel="noopener">完整版本记录</a>。当前已提供的附件以 Release 页面为准。</p></section>
    <section><h2>安装和第一次启动</h2><ol><li>下载并运行安装包，按提示选择安装位置。</li><li>启动 MirrorNovel，确认连接的后端服务可用，然后登录账号。</li><li>进入「模型线路」，配置自己的接口并测试连接；也可以<a href="{{author}}" target="_blank" rel="noopener">联系作者提供模型</a>，咨询接入安排。</li><li>选择题材、人设与世界观，从大纲开始完成第一轮创作。</li></ol><p>当前 Windows 构建未启用代码签名。请从本项目 Release 获取安装包，核对来源与版本后决定是否安装。</p></section>
    <section><h2>安装包里包含什么？</h2><p>桌面界面、本地静态服务和 API 代理包含在安装包中。完整业务后端、数据库与模型权重需要另行准备或由服务提供方提供，桌面端不是完全离线的一体包。</p><p>软件免费下载使用。模型与后端服务是否收费、可用额度多少，取决于你选择的渠道。</p></section>
    <section><h2>接下来做什么？</h2><div class="related-links"><a href="/docs/getting-started/">完成第一次创作 →</a><a href="/docs/model-setup/">配置个人模型 →</a><a href="/docs/self-hosting/">连接自建后端 →</a></div></section>`
  },
  {
    path: '/docs/', section: '使用指南', title: 'MirrorNovel 使用指南：安装、模型配置与创作流程',
    description: '从 MirrorNovel 桌面版安装和模型配置开始，了解长篇创作、已有小说续写、风格润色、短剧改编与自行部署。',
    intro: '先找到当前要解决的问题，再开始创作。',
    body: `<section><h2>准备工作台</h2><div class="guide-grid"><a href="/download/"><h3>下载安装</h3><p>获取 Windows 安装包，了解运行条件。</p><span>查看安装指南 →</span></a><a href="/docs/model-setup/"><h3>配置模型</h3><p>个人 API、Ollama，以及作者提供模型的联系入口。</p><span>查看模型指南 →</span></a><a href="/docs/getting-started/"><h3>第一次创作</h3><p>从题材、人设、大纲到第一章。</p><span>开始创作 →</span></a><a href="/docs/self-hosting/"><h3>自行部署</h3><p>部署后端，并让桌面工作台连接你的服务。</p><span>了解部署 →</span></a></div></section>
    <section><h2>按创作目标选择功能</h2><div class="guide-grid"><a href="/features/long-form-writing/"><h3>长篇创作</h3><p>故事蓝图、章节计划与跨章衔接。</p><span>了解长篇流程 →</span></a><a href="/features/novel-continuation/"><h3>小说续写</h3><p>导入已有正文，整理方向后接着写。</p><span>了解导入与续写 →</span></a><a href="/features/writing-style/"><h3>风格与润色</h3><p>让写作人格与文本修订配合起来。</p><span>了解风格工具 →</span></a><a href="/features/screenplay/"><h3>短剧与改编</h3><p>把设定或已有小说整理成分集分场剧本。</p><span>了解剧本工作台 →</span></a></div></section>
    <section><h2>需要作者帮助？</h2><p>模型接入咨询与作者信息请前往<a href="{{author}}" target="_blank" rel="noopener">作者 GitHub 主页</a>。可复现的软件问题也可以提交到<a href="{{repository}}/issues" target="_blank" rel="noopener">项目 Issues</a>，附上版本、操作步骤与错误信息。</p></section>`
  },
  {
    path: '/docs/getting-started/', section: '使用指南', title: 'MirrorNovel 新手教程：从灵感、大纲到第一章',
    description: '了解 MirrorNovel 的第一次创作流程：完成模型连接，选择题材与人设，确认大纲与故事蓝图，逐章生成、修订和导出。',
    intro: '先完成一小段可检查的故事，再扩展成长篇。',
    body: `<section><h2>1. 先把模型连接准备好</h2><p>安装并登录桌面端后，在「模型线路」填写个人接口信息并测试连接。还没有接口，可以<a href="{{author}}" target="_blank" rel="noopener">联系作者提供模型</a>。创作时需要可用后端和模型服务。</p><p>建议先用少量字数试写，确认模型确实适合当前题材，再安排更长的生成任务。详细设置见<a href="/docs/model-setup/">模型配置指南</a>。</p></section>
    <section><h2>2. 确定题材、人物与世界规则</h2><p>打开「生成小说」，选择普通小说或轻小说入口，组合题材、情节元素、人设与基调。用自己的话写清主角想得到什么、面临什么阻力，以及故事世界有哪些不能违背的规则。</p>{{shot:create}}<p>风格模板可以先跟随题材，也可以选择个人模板。不必在第一轮就填满所有可选项。</p></section>
    <section><h2>3. 确认大纲，再落实到章节</h2><p>生成或填写大纲，直接修改不合适的剧情后再确认。整本创作会进一步规划三级故事蓝图，把全书方向落到阶段安排和近期章节。检查核心冲突、人物动机和阶段转折是否一致。</p><p>示例：如果主角第一阶段的目标是找到失踪的家人，就确认前几章的线索与行动围绕这一目标推进。具体结构见<a href="/features/long-form-writing/">长篇创作指南</a>。</p></section>
    <section><h2>4. 写第一章，检查后继续</h2><p>设置目标字数并开始生成。读完后先检查人物表达、事实衔接和章节目标，再使用润色、编辑或续写功能。作者可以逐步调整，不必一开始就连续生成整本。</p><p>需要中止整本任务时，请使用页面中的暂停操作并等待状态确认。关闭窗口不等于结束后台任务。</p></section>
    <section><h2>5. 保存与导出</h2><p>在书架或作品工作台查看章节。小说支持 TXT 和 ZIP 导出；定期导出重要内容，保留独立备份。已有正文可以从<a href="/features/novel-continuation/">导入续写</a>入口继续创作。</p></section>`
  },
  {
    path: '/docs/model-setup/', section: '使用指南', title: 'MirrorNovel 模型配置教程：个人 API、Ollama 与作者模型',
    description: '为 MirrorNovel 桌面端配置自己的模型接口，按大纲、正文、推理和润色分配模型；了解 Ollama 的后端访问条件，或联系作者提供模型。',
    intro: '选择模型服务，再按创作任务分配线路。',
    body: `<section><h2>两种模型获取方式</h2><p><strong>接入自己的模型：</strong>准备兼容 Chat Completions 的接口地址、API Key 和实际模型名，或使用后端可以访问的 Ollama 服务。</p><p><strong>联系作者提供模型：</strong>没有现成接口时，可以前往<a href="{{author}}" target="_blank" rel="noopener">作者 GitHub 主页</a>，咨询可用模型、接入方式与使用安排。</p><p>软件免费。个人接口和作者模型的可用性、额度与费用，以对应渠道说明为准。</p></section>
    <section><h2>在桌面端添加模型线路</h2><ol><li>打开左侧「模型线路」，点击「添加线路」。</li><li>填写一个便于识别的线路名称。</li><li>按服务商说明填写 Base URL、API Key 和模型名，避免把聊天网页地址当成接口地址。</li><li>执行「测试连接」，按结果修正配置。</li><li>设为默认线路，或继续为不同任务单独分配。</li></ol>{{shot:models}}</section>
    <section><h2>四类任务可以分开配置</h2><div class="table-scroll"><table><thead><tr><th>任务</th><th>主要用途</th><th>选择时关注</th></tr></thead><tbody><tr><td>大纲</td><td>故事方向、蓝图与规划</td><td>结构与指令执行</td></tr><tr><td>正文</td><td>章节与剧本文字</td><td>文笔、上下文与题材表现</td></tr><tr><td>推理</td><td>审阅、分析与参考整理</td><td>分析能力与处理预算</td></tr><tr><td>润色</td><td>表达调整与编辑处理</td><td>保持情节与修改质量</td></tr></tbody></table></div><p>可以先让所有任务跟随默认线路，再用同一小段材料试写，逐步决定是否拆分。桌面端当前最多管理六条本机线路。</p></section>
    <section><h2>使用 Ollama 时，地址指向哪台电脑？</h2><p>模型调用由后端发起。配置中的 <code>127.0.0.1</code> 或 <code>localhost</code> 指的是后端所在机器。远程后端不能直接用这个地址访问你自己电脑上的 Ollama，需要使用实际可达、受保护的网络连接。</p><p>同机服务常见地址是 <code>http://127.0.0.1:11434</code>，应按当前后端及模型服务的配置使用，并验证连接。不要为了连接而直接把未保护的模型服务暴露到公网。</p></section>
    <section><h2>测试失败或正文没有输出</h2><ul><li>认证失败：检查密钥是否有效、服务是否允许调用该模型。</li><li>模型不存在：从提供方获取准确模型名，不要只填显示名称。</li><li>超时或截断：先减少试写长度，确认上下文、思考预算和输出限制是否匹配。</li><li>Ollama 不可达：从后端所在机器检查地址、端口与网络。</li></ul><p>短请求成功不代表长篇和思考参数全部兼容。先试写并检查结果，再启动整本任务。</p></section>
    <section><h2>配置保存与费用</h2><p>「仅存本机」表示模型配置保存在本机；调用时仍会随请求发送给后端，由后端访问模型。「同步到账号」会把默认线路配置保存到服务端。它们不表示 API Key 从不离开设备。</p><p>界面中的用量统计不等于服务商账单；失败、重试和批量修订也可能产生费用。重要任务先确认额度，再进入<a href="/docs/getting-started/">第一次创作</a>。</p></section>`
  },
  {
    path: '/docs/self-hosting/', section: '使用指南', title: 'MirrorNovel 自行部署与桌面后端连接指南',
    description: '了解 MirrorNovel 的 Node.js、MongoDB、模型与 SMTP 运行条件，部署业务后端，并通过 MN_API_TARGET 连接 Windows 桌面工作台。',
    intro: '源码开放，运行环境和模型服务可以按自己的需要安排。',
    body: String.raw`<section><h2>先准备运行环境</h2><ul><li>Node.js 22：与项目质量检查和桌面构建环境保持一致。</li><li>MongoDB 6 或更高版本，以及可连接的数据库账号。</li><li>兼容模型 API，或后端可访问的 Ollama。</li><li>用于账号注册和密码找回的 SMTP 邮件服务。</li></ul><p>桌面安装包里的本地 HTTP 服务只负责界面和 API 代理，不能代替 Express 业务后端或数据库。完整配置以<a href="{{repository}}#self-hosting" target="_blank" rel="noopener">仓库部署文档</a>为准。</p></section>
    <section><h2>获取源码并安装依赖</h2><pre><code>git clone https://github.com/Aerdelan/MirrorNovel.git
cd MirrorNovel
npm --prefix server ci
npm --prefix client ci
npm --prefix admin ci</code></pre><p>在 Windows PowerShell 中复制配置示例：</p><pre><code>Copy-Item server/.env.example server/.env</code></pre><p>在本机编辑配置文件，设置数据库连接、随机 JWT 密钥、管理员信息、模型和 SMTP。示例中的默认密码与密钥必须替换。不要把真实密钥提交到源码仓库。</p></section>
    <section><h2>启动服务并确认可用</h2><p>分别在独立终端启动需要的服务：</p><pre><code>npm --prefix server run dev
# 另一个终端：
npm --prefix client run dev
# 如需管理端，再打开一个终端：
npm --prefix admin run dev</code></pre><p>API 健康检查的默认地址是 <code>http://localhost:3000/api/health</code>。先确认数据库与 API 服务可用，再连接桌面端。开发命令用于本地调试；正式部署还需配置 HTTPS、进程管理、访问控制与数据库备份。</p></section>
    <section><h2>让已安装的桌面端连接你的后端</h2><p>退出已运行的 MirrorNovel，在安装目录的 PowerShell 中设置运行时目标，再启动程序：</p><pre><code>$env:MN_API_TARGET = 'http://127.0.0.1:3000'
.\MirrorNovel.exe</code></pre><p>把示例地址替换为你的真实后端。另一个终端中的环境变量不会改变已运行进程，切换后端后需要从设置了变量的终端重新启动。</p><p>开发模式使用 <code>MN_SERVER</code>，详情见仓库的桌面开发章节。<code>MN_API_TARGET</code> 不是单纯设置在打包阶段就会固化的配置。</p></section>
    <section><h2>数据和维护</h2><p>作品保存在连接后端的数据库中。自行部署时请定期备份数据库和重要配置，并导出作品。模型参数、搜索、生图和邮件属于各自独立服务，按实际需要开启。</p><p>软件采用 AGPL-3.0-only。修改、分发或提供修改版网络服务时，请阅读<a href="{{repository}}/blob/main/LICENSE" target="_blank" rel="noopener">完整许可证</a>与仓库许可说明。</p><div class="related-links"><a href="/docs/model-setup/">继续配置模型 →</a><a href="/download/">下载桌面版 →</a></div></section>`
  },
  {
    path: '/features/long-form-writing/', section: '创作功能', title: 'AI 长篇小说创作：故事蓝图、章节计划与连续性管理',
    description: 'MirrorNovel 用大纲、三级故事蓝图、滚动章节计划与上下文管理辅助 AI 长篇小说创作，支持整本生成、暂停恢复、修订与导出。',
    intro: '把全书方向落到阶段，再落到下一章。',
    body: `<section><h2>长篇难在后面的章节还能接得上</h2><p>故事写长之后，人物目标、关系和伏笔都在变化。MirrorNovel 把规划与正文组织在同一个作品中，用章节摘要、人物状态、伏笔与阶段目标辅助后续创作。它们帮助减少跑题和重复，关键情节仍由作者检查。</p></section>
    <section><h2>大纲之后，还有三级故事蓝图</h2><div class="table-scroll"><table><thead><tr><th>层级</th><th>规划什么</th></tr></thead><tbody><tr><td>全书级篇章</td><td>主线、阶段目标、主要阻力与关键反转。</td></tr><tr><td>篇章内小阶段</td><td>人物声线、关系变化、必备场景和伏笔。</td></tr><tr><td>滚动执行蓝图</td><td>未来约 10–20 章的执行卡、章节目的与章末钩子。</td></tr></tbody></table></div><p>例如，先确定“主角查明家族失踪真相”的全书主线，再规划“找到第一条线索”的阶段，最后为近期章节安排需要出现的证据、人物选择与冲突。生成前可以编辑大纲并确认，不合适的方向先调整。</p>{{shot:outline}}</section>
    <section><h2>整本推进，也能按章细写</h2><p>需要连续推进时，可按目标字数和章节安排生成整本；需要细调时，可以单章创作、续写和编辑。作品页支持蓝图复核、查看提案并决定是否应用，近期正文与计划偏离的检查结果也供作者判断。</p><p>可选专家团参与连续性审阅；生成链路还包含计划、重复内容与质量检查等约束。模型执行能力会影响最终结果，不能把检查功能当作故事无矛盾的保证。</p></section>
    <section><h2>暂停、修订和导出</h2><p>生成任务保存状态与中章草稿。需要停止整本生成或续写时，请使用暂停并等待状态确认；客户端断开后后台任务可能继续。返回作品页可重新查询进度。</p><p>正文可按章修订，部分修改操作保留章节历史。小说支持 TXT 与 ZIP 导出，便于独立备份。历史与断点保存不替代完整备份。</p><div class="related-links"><a href="/docs/getting-started/">从第一章开始 →</a><a href="/features/novel-continuation/">已有作品接着写 →</a><a href="/download/">下载 Windows 版 →</a></div></section>`
  },
  {
    path: '/features/novel-continuation/', section: '创作功能', title: 'AI 小说续写：导入已有正文并继续创作',
    description: '用 MirrorNovel 上传 TXT 或粘贴已有小说正文，设置续写方向和字数，结合上下文继续章节；了解续写、参考库导入与任务暂停的区别。',
    intro: '带上你已经写过的故事，从下一段接着走。',
    body: `<section><h2>已有正文，也能进入创作流程</h2><p>在「小说续写」入口上传 TXT 文件或粘贴正文，补充你希望接下去发生什么、希望写多少字，再整理上下文后继续创作。已经在书架中的作品，也可以在作品页使用章节续写或整本续写。</p>{{shot:continue}}</section>
    <section><h2>给续写一个清楚的方向</h2><p>除了正文，尽量写清近期目标和不能改变的事实。例如：“这一章让主角获得线索，但暂时不揭露凶手；保留两个人互不信任的关系。”比只写“继续”更便于检查结果。</p><ol><li>确认导入文本包含当前创作需要的前情。</li><li>填写下一段的目标、约束与字数。</li><li>检查人物状态、未决问题及已有计划。</li><li>先续写一章，读完再决定后续推进。</li></ol><p>系统结合摘要、人物状态、计划和蓝图辅助衔接；如果前文信息不足或模型理解有误，仍需要手动补充与修订。</p></section>
    <section><h2>正文续写与参考库是两种入口</h2><p>这里的正文续写支持 TXT 上传与粘贴。参考库另外支持 TXT、Markdown、EPUB 和 ZIP，用于参考分析、风格蒸馏等；不要把参考库的格式支持当成续写入口的格式支持。</p><p>导入和处理材料前，请确认你拥有相应的使用权。参考分析并不会自动获得他人作品的改编授权。</p></section>
    <section><h2>续写以后继续修订</h2><p>检查衔接位置有没有重复叙述、人物说话方式是否一致、线索是否提前泄露。需要表达调整时进入<a href="/features/writing-style/">风格与润色</a>，需要结构调整时回看<a href="/features/long-form-writing/">故事蓝图</a>。</p><p>整本续写可能在关闭窗口后继续运行。请通过暂停操作确认停止状态，并定期导出作品。</p><div class="related-links"><a href="/docs/model-setup/">准备模型线路 →</a><a href="/download/">下载桌面工作台 →</a></div></section>`
  },
  {
    path: '/features/writing-style/', section: '创作功能', title: 'AI 小说文风调整与润色：写作人格和个人风格模板',
    description: '在 MirrorNovel 中结合题材、标签与写作人格定义文风，创建个人模板，再用文本润色、差异对比和编辑工具逐步修订作品。',
    intro: '风格可以复用，文字也可以一轮轮打磨。',
    body: `<section><h2>先让题材、标签与声线一致</h2><p>普通小说与轻小说入口提供不同的题材和标签组合。默认设置会跟随题材定调；也可以选择写作人格，进一步规定语气、节奏、词汇偏好与写作规则。</p>{{shot:style}}<p>轻松日常与冷硬悬疑需要不同的句式和情绪节奏。先写清自己希望保留的表现，再用一段正文检查，逐步调整模板。</p></section>
    <section><h2>创建自己的风格模板</h2><p>可以使用系统预设、克隆预设为个人副本、手动创建模板，或让 AI 辅助生成。已经蒸馏的参考档案也可以提炼为个人写作风格，便于后续复用。</p><p>作品保存所选人格快照。后续编辑模板，不会直接改写已有作品的风格配置。模板用于表达偏好，具体结果还要看模型和材料。</p></section>
    <section id="polish"><h2>写完之后，再修改表达</h2><p>文本润色可以输入或上传已有文字，选择润色方案、补充自定义要求，再查看生成结果并决定如何保存。需要减轻套话或重复表达时，可使用去 AI 味相关改写与差异对比。</p>{{shot:polish}}<p>系统性修订还可以使用编辑引擎，按结构、风格一致与表达问题逐步处理。改写可能改变细节、语气或人物表达，回写前应检查差异。</p></section>
    <section><h2>适合怎么用？</h2><ul><li>网文作者：把常用叙述节奏与对话习惯整理成可复用模板。</li><li>轻小说创作者：用题材、人设和人格共同控制口吻。</li><li>已有作品改稿：先改一章，确认方向，再扩大处理范围。</li></ul><p>表达优化不保证通过任何第三方 AI 检测或平台审核。重要作品保留原稿与独立备份。</p><div class="related-links"><a href="/docs/getting-started/">第一次创作 →</a><a href="/features/novel-continuation/">导入正文继续写 →</a><a href="/download/">下载桌面版 →</a></div></section>`
  },
  {
    path: '/features/screenplay/', section: '创作功能', title: 'AI 短剧剧本创作与小说改编工作台',
    description: 'MirrorNovel 支持原创连续短剧与已有小说改编，从剧本圣经、分集大纲到逐集逐场创作，提供编辑、质量检查与多格式导出。',
    intro: '把故事整理成可以逐集、逐场推进的剧本。',
    body: `<section><h2>原创短剧，或者从小说改编</h2><p>「AI 剧本」提供独立项目工作流。可以从原创设定开始，也可以选择当前账号的已有小说作为改编来源，并设置集数、单集时长和改编重点。</p><p>短剧、轻小说和长篇作者可以在同一个创作项目体系中探索不同形式。小说改编会携带来源快照，并沿用相关参考与人格信息。</p></section>
    <section><h2>先建立剧本圣经</h2><p>在逐场写作之前，统一故事前提、角色视觉与目标、人物关系、场景空间和连续性规则，再规划分集大纲。原创项目可以让 AI 扩展人物、空间、支线和伏笔，确认后应用。</p><p>例如，先确定每集的主要冲突、角色在场情况与场景限制，再写镜头或动作。重复出现的角色与地点可以据此保持一致。</p></section>
    <section><h2>按交付目标组织场景</h2><div class="table-scroll"><table><thead><tr><th>方向</th><th>重点</th></tr></thead><tbody><tr><td>视频生成方向</td><td>镜头、画面重点、转场与场景描述。</td></tr><tr><td>实拍制作方向</td><td>布景、走位、道具和执行提示。</td></tr></tbody></table></div><p>这里的“视频生成”指剧本文本的交付方向。工作台当前不负责调用视频模型生成完整视频。</p></section>
    <section><h2>逐场编辑，逐集检查</h2><p>支持单集生成、重生成、批量生成未完成集、修复问题剧集以及暂停和继续批量任务。已有场景可以手工修改动作、对白、潜台词与制作说明，手工保存不调用 AI。</p><p>配置可用生图线路后，可以按需生成人物头像、关系图和场景图；生图是可选服务，没有生图线路也可以使用文字剧本。</p></section>
    <section><h2>导出交付</h2><p>剧本支持 TXT、Markdown、HTML 与 DOCX 导出，桌面端可使用保存对话框。交付前仍需人工检查连续性、可执行性与素材权利。</p><div class="related-links"><a href="/docs/model-setup/">选择模型线路 →</a><a href="/features/long-form-writing/">先完成来源小说 →</a><a href="/download/">下载工作台 →</a></div></section>`
  }
];

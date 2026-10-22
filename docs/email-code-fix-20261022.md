# 验证码邮件修复说明（2026-10-22）

现象：点「获取验证码」界面提示"验证码已发送到邮箱，请注意查收"，但邮箱里什么都没有。

排查结论：服务端**根本没有发信**。`/api/auth/send-code` 返回的是
`{"message":"验证码已生成（邮箱服务暂不可用，请在控制台查看验证码）","code":"369632"}`
—— 走了降级分支，验证码只打印在服务器日志里。而前端不看这个标志，一律弹"请注意查收"，所以故障被完全掩盖。

本机直连 `smtp.163.com:465` 做 SMTP 登录握手是成功的（719ms），说明授权码、主机、端口、SSL 都是对的，问题在服务器那一侧的连接或一次偶发失败被永久固化。

## 改了什么

| 文件 | 改动 |
| --- | --- |
| `server/services/emailService.js` | 健康状态收进本模块：失败只推迟下一次探测，按 15s/30s/1m/2m/5m 退避自动重探，探测通过即恢复发信。`verify()` 超时 5s → 15s（冷启动 TCP+TLS+AUTH 三轮往返，5s 在云服务器上容易把"慢"误判成"不可用"）。SMTP 错误压成一行含 code/response 的文本写日志，对外只给粗分类。发信成功后记录 messageId 便于对账。 |
| `server/routes/auth.js` | 删掉 `emailEnabled` 单向闩锁（旧版一次失败就 false 到进程重启，期间接口仍返回"已发送"）。响应新增 `emailSent` 布尔标志。明文验证码从响应里移除，改由 `EMAIL_RETURN_CODE_ON_FAILURE` 控制，默认不返回。 |
| `server/index.js` | `/api/health` 增加 `email` 字段，不用 SSH 登服务器就能判断发信能力。 |
| `client/src/views/RegisterPage.vue`、`ForgotPasswordPage.vue` | 按 `emailSent` 决定文案，邮件没发出去时明确提示失败，不再谎报"请注意查收"。 |
| `client/src/locales/zh.js`、`en.js` | 新增 `auth.codeEmailFailed`、`auth.resetCodeEmailFailed`。 |
| `server/tests/emailHealth.test.js` | 回归测试：可自愈、错误可分类、不外泄凭据。 |

## 部署

1. 备份服务器上的 `server` 目录与数据库。服务器 `.env` **不要覆盖**（更新包里不含 `.env`）。
2. 用更新包里的 `server/` 覆盖服务器对应目录，保留 `.env`、Cookie 等运行数据。
3. `server` 目录执行 `npm ci --omit=dev`，然后按原有方式（PM2 / systemd）重启。
4. 若使用网页端，把 `client/dist` 与 `admin/dist` 发布到原静态站点目录，路由与 API 代理配置不变。
5. 桌面端换用 `MirrorNovel Setup 1.1.1.exe`。旧安装包没有本次的文案修正。

## 验证

```bash
curl -s http://127.0.0.1:5173/api/health
```

看返回里的 `email` 字段：

```json
"email": { "ready": true, "probed": true, "consecutiveFailures": 0,
           "errorKind": "", "configured": true, "host": "smtp.163.com", "port": "465" }
```

- `ready: true` → 发信可用，去注册页走一遍应当收到邮件（没收到就先翻垃圾箱）。
- `ready: false` + `configured: false` → 服务器 `.env` 缺 `EMAIL_HOST/EMAIL_USERNAME/EMAIL_PASSWORD`，补上后重启。
- `ready: false` + `errorKind: "timeout"` 或 `"unreachable"` → **云厂商封了 SMTP 出网**（43.159.x 是腾讯云段，默认常封 25，部分账号 465 也要申请解封）。提工单解封 465 出网，或改用 80/587 + STARTTLS，或换成腾讯云 SES 这类走 HTTP API 的发信服务。
- `ready: false` + `errorKind: "auth"` → 授权码或账号问题（本机握手是成功的，所以多半是服务器上的 `.env` 与本地这份不一致）。

修复后不再需要"重启才能恢复"：连接恢复的下一次退避探测会自动把发信打开，日志里会出现
`✅ 邮箱服务已恢复，重新启用邮件发送`。

## 需要立刻收紧的一项安全设置

旧版在邮箱不可用时把明文验证码直接回写进 HTTP 响应，任何人调一次接口就能拿到验证码注册，`send-reset-code` 同样如此（等于可改他人密码）。本次已默认关闭，响应里不再有 `code`。

若本地排查需要，在 `server/.env` 加 `EMAIL_RETURN_CODE_ON_FAILURE=true`，用完删掉。

## 验证记录

- 后端测试 234 项通过（原 229 项 + 本次新增 5 项邮箱健康状态测试）。
- 前端测试 39 项通过，`npm run check:i18n` 通过。
- 用户网页、管理网页构建完成；Windows 安装包 `MirrorNovel Setup 1.1.1.exe` 出包成功。
- 未改动服务器配置与线上数据；未进行真实发信验收（需要服务器侧网络解封后才能测）。

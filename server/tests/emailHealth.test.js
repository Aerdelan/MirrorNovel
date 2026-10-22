const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * 邮箱健康状态的回归测试。
 *
 * 线上故障：routes/auth.js 用一个模块级布尔量做单向闩锁，启动探测失败或某次
 * sendMail 抛错就一路 false 到进程重启，期间接口仍返回"验证码已发送"，
 * 前端又一律弹"请注意查收"，于是"显示成功但收不到邮件"完全无法被发现。
 * 这里锁住修复后的三条性质：可自愈、错误可分类、不外泄凭据。
 */
const emailService = require('../services/emailService');
const { isEmailReady, markSendFailure, getEmailStatus } = emailService;
const { markSendSuccess } = emailService;

test('未探测前乐观允许发信，避免冷启动把可用配置误判成降级', () => {
  const status = getEmailStatus();
  assert.equal(status.probed, false);
  assert.equal(isEmailReady(), true);
});

test('发信失败后降级，并把 SMTP 错误归成可对外暴露的类别', () => {
  markSendFailure(Object.assign(new Error('Message failed'), {
    code: 'EAUTH',
    response: '535 Error: authentication failed',
    responseCode: 535,
  }));

  const status = getEmailStatus();
  assert.equal(status.ready, false);
  assert.equal(isEmailReady(), false);
  assert.equal(status.errorKind, 'auth');
  assert.equal(status.consecutiveFailures, 1);
  assert.ok(status.lastCheckAt, '应记录探测时间');
});

test('云主机封 SMTP 出网这类超时/不可达要能区分出来（本次线上最可能的根因）', () => {
  markSendFailure(Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' }));
  assert.equal(getEmailStatus().errorKind, 'timeout');

  markSendFailure(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));
  assert.equal(getEmailStatus().errorKind, 'unreachable');

  // 次数持续累加，用于观察退避节奏，且不得抛错
  assert.ok(getEmailStatus().consecutiveFailures >= 3);
});

test('一次成功发信即判定可用并清空退避（自愈路径，替代旧的必须重启）', () => {
  markSendSuccess();

  const status = getEmailStatus();
  assert.equal(status.ready, true);
  assert.equal(isEmailReady(), true);
  assert.equal(status.errorKind, '');
  assert.equal(status.consecutiveFailures, 0);
});

test('对外状态不含发件邮箱、密码与 SMTP 原始错误文本', () => {
  process.env.EMAIL_HOST = 'smtp.secret-host.test';
  process.env.EMAIL_PORT = '465';
  process.env.EMAIL_USERNAME = 'secret-sender@163.com';
  process.env.EMAIL_PASSWORD = 'secret-auth-code';

  markSendFailure(new Error('login failed for secret-sender@163.com with secret-auth-code'));
  const serialized = JSON.stringify(getEmailStatus());

  // 主机与端口要保留（用于确认服务器加载的是哪份配置），但凭据与原文不能出现
  assert.match(serialized, /smtp\.secret-host\.test/);
  assert.doesNotMatch(serialized, /secret-sender/);
  assert.doesNotMatch(serialized, /secret-auth-code/);
  assert.ok(!('error' in getEmailStatus()), '不应把原始错误文本放进对外结构');

  markSendSuccess();
});

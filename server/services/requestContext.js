/**
 * 请求级上下文（AsyncLocalStorage）
 *
 * 解决的问题：写作 agent、编辑引擎、去AI化、后台批处理等内部调用链很长，
 * 历史上有多处调用 streamGenerate / runEditorialPipeline 时**没有把用户的
 * 模型配置一路传下来**，resolveApiConfig(null) 就会静默落到服务器默认线路——
 * 用户在「我的/模型线路」里配好的接口对那几步完全不生效，还以为是配置错了。
 *
 * 做法：鉴权中间件把"本次请求实际生效的模型配置"放进 ALS，所有没拿到显式
 * 配置的调用自动回退到这里。ALS 会跟随 async 链路传播，因此路由里启动的
 * 后台任务（不 await 的 Promise）也在同一上下文内。
 */

const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();

/** 在指定上下文内执行；store 至少包含 { userModelConfig } */
function runWithRequestContext(store, fn) {
  return als.run(store, fn);
}

/** 取当前请求生效的模型配置；不在请求上下文内时返回 null */
function getRequestModelConfig() {
  const store = als.getStore();
  return (store && store.userModelConfig) || null;
}

module.exports = {
  runWithRequestContext,
  getRequestModelConfig,
};

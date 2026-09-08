// 平台暂不支持强制深度推理模型：服务端识别到此类模型会返回固定提示。
// 该错误换参数重试必然失败，需要用户手动切换模型，所以用弹窗强提醒，
// 而不是只在状态栏一闪而过。返回是否已弹出，调用方可据此跳过其他提示。
export function notifyModelError(message) {
 const text = String(message || '')
 if (text.includes('暂不支持深度推理')) {
  alert('当前暂不支持深度推理模型接入，请切换模型')
  return true
 }
 return false
}

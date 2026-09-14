import { computed, ref } from 'vue'
import {
  readLocalModelConfig,
  writeLocalModelConfig,
  clearLocalModelConfig,
  normalizeLocalConfig,
  buildModelOverrideHeader,
  createRoute,
  resolveTaskRouteId,
  HEADER_NAME,
  LOCAL_CONFIG_KEY,
  MODEL_ROLE_KEYS,
} from '@client/utils/modelOverride'

/**
 * 桌面端模型线路（单机版核心）
 *
 * 用户可以配置**多条**线路，每条线路 = 一个名称 + 一套 Base URL / API Key + 各任务模型名；
 * 再把「默认线路」与「各任务用哪条线路」分配好。配置只存在本机 localStorage，
 * 每次请求通过 x-mn-model-config 请求头带给服务端，服务端仅在本次调用使用、绝不落库。
 *
 * 结构定义与序列化统一放在 @client/utils/modelOverride，
 * 与 client 的 axios 拦截器共用同一份实现，避免两边规则漂移。
 */
export {
  HEADER_NAME,
  LOCAL_CONFIG_KEY,
  MODEL_ROLE_KEYS,
  createRoute,
  resolveTaskRouteId,
  buildModelOverrideHeader,
  normalizeLocalConfig,
}

export function useModelConfig() {
  const localConfig = ref(readLocalModelConfig())

  const hasLocal = computed(() => Boolean(localConfig.value?.routes?.length))

  /** 保存整份配置（会做归一化与上限裁剪），返回落盘后的结构 */
  function saveConfig(config) {
    const normalized = normalizeLocalConfig(config)
    if (!normalized) return null
    writeLocalModelConfig(normalized)
    localConfig.value = normalized
    return normalized
  }

  function clearLocal() {
    clearLocalModelConfig()
    localConfig.value = null
  }

  /** 从存储重新读取（多窗口/多标签场景下保持同步） */
  function reload() {
    localConfig.value = readLocalModelConfig()
  }

  return { localConfig, hasLocal, saveConfig, clearLocal, reload }
}

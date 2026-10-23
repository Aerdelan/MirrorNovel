import { computed, onUnmounted, ref } from 'vue'
import { retryAfterSeconds } from '../../../shared/authRetry.mjs'

export function useVerificationCode() {
 const sending = ref(false), countdown = ref(0)
 let timer, disposed = false
 const active = () => !disposed
 function resetCountdown() { clearInterval(timer); countdown.value = 0 }
 function startCountdown(seconds = 30) {
  clearInterval(timer)
  const deadline = Date.now() + seconds * 1000
  const tick = () => {
   countdown.value = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
   if (!countdown.value) clearInterval(timer)
  }
  tick(); timer = setInterval(tick, 1000)
 }
 function startFromResponse(data) { startCountdown(retryAfterSeconds(data)) }
 function handleRateLimit(error) {
  if (error.response?.status === 429 && !disposed) startCountdown(retryAfterSeconds(error.response.data, error.response.headers))
 }
 onUnmounted(() => { disposed = true; clearInterval(timer) })
 return { sending, countdown, active, resetCountdown, startFromResponse, handleRateLimit, available: computed(() => !sending.value && !countdown.value) }
}

import { computed, onUnmounted, ref } from 'vue'
import { retryAfterSeconds } from '../../../shared/authRetry.mjs'

// Use the server deadline so background tabs do not stretch the cooldown.
export function useVerificationCode() {
 const sending = ref(false)
 const countdown = ref(0)
 let timer
 let disposed = false
 const active = () => !disposed
 function startCountdown(seconds = 30) {
  clearInterval(timer)
  const deadline = Date.now() + seconds * 1000
  const tick = () => {
   countdown.value = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
   if (!countdown.value) clearInterval(timer)
  }
  tick()
  timer = setInterval(tick, 1000)
 }
 onUnmounted(() => { disposed = true; clearInterval(timer) })
 function resetCountdown() { clearInterval(timer); countdown.value = 0 }
 function startFromResponse(response) { startCountdown(retryAfterSeconds(response?.data, response?.headers)) }
 function handleRateLimit(error) {
  if (error.response?.status !== 429 || disposed) return
  startFromResponse(error.response)
 }
 const available = computed(() => !sending.value && countdown.value === 0)
 return { sending, countdown, available, startCountdown, active, handleRateLimit, startFromResponse, resetCountdown }
}

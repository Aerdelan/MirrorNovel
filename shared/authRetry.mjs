// Axios, uni.request and the auth responses all use the same retry timing.
export function retryAfterSeconds(payload, headers, fallback = 30, now = Date.now()) {
 const bodySeconds = Number(payload?.retryAfter)
 if (Number.isFinite(bodySeconds) && bodySeconds > 0) return Math.ceil(bodySeconds)
 const header = headers?.get?.('retry-after') ?? Object.entries(headers || {}).find(([key]) => key.toLowerCase() === 'retry-after')?.[1]
 if (header !== undefined && header !== null && String(header).trim()) {
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(1, Math.ceil(seconds))
  const deadline = Date.parse(header)
  if (Number.isFinite(deadline)) return Math.max(1, Math.ceil((deadline - now) / 1000))
 }
 return fallback
}

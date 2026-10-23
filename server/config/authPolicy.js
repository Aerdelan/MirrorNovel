function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

module.exports = {
  codeResendSeconds: positiveInteger(process.env.EMAIL_CODE_RESEND_SECONDS, 30),
  codeMaxAttempts: positiveInteger(process.env.EMAIL_CODE_MAX_ATTEMPTS, 10),
  codeIpLimit: positiveInteger(process.env.EMAIL_CODE_IP_LIMIT, 300),
};

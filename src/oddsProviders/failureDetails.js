// Return only documented codes and dates, never arbitrary provider bodies.
const reasons = {
  HISTORICAL_LIMIT: 'historical_window_exceeded',
  credit_limit_exceeded: 'credits_exhausted',
  OUT_OF_USAGE_CREDITS: 'credits_exhausted',
  KEY_ROTATED: 'key_rotated', KEY_EXPIRED: 'key_expired', KEY_REVOKED: 'key_revoked'
};
export function failureDetails(body, status) {
  const candidate = body?.error?.code ?? body?.code ?? body?.error_code ?? body?.error;
  const errorCode = Object.hasOwn(reasons, candidate) ? candidate : null;
  const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T[\d:.+-]+Z?)?$/.test(value) && Number.isFinite(Date.parse(value)) ? value : undefined;
  return {
    reason: errorCode ? reasons[errorCode] : status === 429 ? 'rate_limited' : status === 401 ? 'authentication_failed' : status === 403 ? 'access_denied' : 'upstream_error',
    ...(errorCode ? { errorCode } : {}),
    ...(date(body?.allowed_from) ? { allowedFrom: date(body.allowed_from) } : {}),
    ...(date(body?.next_reset_at) ? { nextResetAt: date(body.next_reset_at) } : {})
  };
}

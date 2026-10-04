// Derived read metadata only: do not rewrite saved inventory during analysis.
export function annotatePromoAvailability(promo, now = Date.now()) {
  const raw = promo.expires_at;
  const expires = raw ? Date.parse(raw) : NaN;
  const expirationState = !Number.isFinite(expires) ? 'unknown'
    : expires <= now ? 'expired' : 'not_expired';
  const status = String(promo.status || 'NEW').toUpperCase();
  const effectiveStatus = ['NEW', 'AVAILABLE'].includes(status) && expirationState === 'expired'
    ? 'EXPIRED' : status;
  return { ...promo, effective_status: effectiveStatus,
    expiration_state: expirationState,
    availability_requires_confirmation: ['NEW', 'AVAILABLE'].includes(effectiveStatus),
    availability_checked_at: new Date(now).toISOString() };
}

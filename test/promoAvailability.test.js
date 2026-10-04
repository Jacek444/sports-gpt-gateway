import test from 'node:test';
import assert from 'node:assert/strict';
import { annotatePromoAvailability } from '../src/promoAvailability.js';
const now = Date.parse('2026-10-04T02:00:00Z');
test('overdue available tokens are effectively expired without changing saved status', () => {
  const promo = { status: 'AVAILABLE', expires_at: '2026-10-03T14:11:00Z' };
  const result = annotatePromoAvailability(promo, now);
  assert.equal(result.status, 'AVAILABLE');
  assert.equal(result.effective_status, 'EXPIRED');
  assert.equal(result.expiration_state, 'expired');
  assert.equal(result.availability_requires_confirmation, false);
  assert.equal(promo.effective_status, undefined);
});
test('null or malformed expiry is unknown, not expired or verified available', () => {
  for (const expires_at of [null, '', 'not-a-date']) {
    const result = annotatePromoAvailability({ status: 'AVAILABLE', expires_at }, now);
    assert.equal(result.effective_status, 'AVAILABLE');
    assert.equal(result.expiration_state, 'unknown');
    assert.equal(result.availability_requires_confirmation, true);
  }
});
test('used and void tokens retain their state; expiry boundary is explicit', () => {
  for (const status of ['USED', 'VOID']) {
    assert.equal(annotatePromoAvailability({ status, expires_at: '2026-10-01T00:00:00Z' }, now).effective_status, status);
  }
  assert.equal(annotatePromoAvailability({ status: 'NEW', expires_at: new Date(now).toISOString() }, now).effective_status, 'EXPIRED');
  assert.equal(annotatePromoAvailability({ status: 'NEW', expires_at: new Date(now + 1000).toISOString() }, now).expiration_state, 'not_expired');
});

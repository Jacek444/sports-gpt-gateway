import { createClient } from '@supabase/supabase-js';
import { HttpError } from './errors.js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl) {
  throw new Error('SUPABASE_URL environment variable is required');
}

if (!supabaseSecretKey) {
  throw new Error('SUPABASE_SECRET_KEY environment variable is required');
}

const supabase = createClient(supabaseUrl, supabaseSecretKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false
  }
});

function normalizeString(value, fieldName) {
  const normalized = String(value ?? '').trim();

  if (!normalized) {
    throw new HttpError(400, `Field "${fieldName}" is required`);
  }

  return normalized;
}

function normalizeNumber(value, fieldName, { minimum = null } = {}) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const number = Number(value);

  if (Number.isNaN(number)) {
    throw new HttpError(400, `Field "${fieldName}" must be a number`);
  }

  if (minimum !== null && number < minimum) {
    throw new HttpError(
      400,
      `Field "${fieldName}" must be at least ${minimum}`
    );
  }

  return number;
}

function normalizeBoolean(value) {
  return (
    value === true ||
    value === 'true' ||
    value === 1 ||
    value === '1'
  );
}

function createBetId() {
  return `bet_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createPostmortemId() {
  return `postmortem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function listBetLogEntries({
  limit = 50,
  offset = 0,
  start_date = null,
  end_date = null,
  sport = null,
  result = null
} = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  let query = supabase
    .from('bet_log')
    .select('*')
    .order('created_at', { ascending: false })
    .range(safeOffset, safeOffset + safeLimit - 1);

  if (start_date) {
    query = query.gte('date', start_date);
  }

  if (end_date) {
    query = query.lte('date', end_date);
  }

  if (sport) {
    query = query.eq('sport', sport);
  }

  if (result) {
    query = query.eq('result', result);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Supabase listBetLogEntries error:', error);
    throw new HttpError(500, 'Failed to read bet log entries');
  }

  return data || [];
}

export async function addBetLogEntry(input) {
  const entry = {
    id: createBetId(),
    date: normalizeString(input.date, 'date'),
    sport: normalizeString(input.sport, 'sport'),
    league: normalizeString(input.league, 'league'),
    event: normalizeString(input.event, 'event'),
    market: normalizeString(input.market, 'market'),
    selection: normalizeString(input.selection, 'selection'),
    line: input.line ?? null,
    odds: normalizeString(input.odds, 'odds'),
    sportsbook: normalizeString(input.sportsbook, 'sportsbook'),
    stake_usd: normalizeNumber(input.stake_usd, 'stake_usd', { minimum: 0 }),
    units: normalizeNumber(input.units, 'units', { minimum: 0 }),
    is_bonus_bet: normalizeBoolean(input.is_bonus_bet),
    boost_used: normalizeBoolean(input.boost_used),
    ev_percent: normalizeNumber(input.ev_percent, 'ev_percent'),
    fair_odds: input.fair_odds ?? null,
    kelly_percent: normalizeNumber(input.kelly_percent, 'kelly_percent'),
 reason: String(input.reason ?? '').trim() || null,

confidence: String(input.confidence ?? '').trim() || null,
primary_script: String(input.primary_script ?? '').trim() || null,
failure_script: String(input.failure_script ?? '').trim() || null,
supporting_evidence:
  String(input.supporting_evidence ?? '').trim() || null,
contradicting_evidence:
  String(input.contradicting_evidence ?? '').trim() || null,
market_reason: String(input.market_reason ?? '').trim() || null,
handicap_tags: Array.isArray(input.handicap_tags)
  ? input.handicap_tags
      .map((value) => String(value).trim())
      .filter(Boolean)
  : null,

result: String(input.result ?? '').trim() || null,
payout_usd: normalizeNumber(input.payout_usd, 'payout_usd', { minimum: 0 }),
closing_line: input.closing_line ?? null,
closing_odds: String(input.closing_odds ?? '').trim() || null,
closing_book: String(input.closing_book ?? '').trim() || null,
clv_percent: normalizeNumber(input.clv_percent, 'clv_percent'),
clv_status: String(input.clv_status ?? '').trim() || null,
clv_notes: String(input.clv_notes ?? '').trim() || null,
postmortem: String(input.postmortem ?? '').trim() || null,
created_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from('bet_log')
    .insert(entry)
    .select()
    .single();

  if (error) {
    console.error('Supabase addBetLogEntry error:', error);
    throw new HttpError(500, 'Failed to save bet log entry');
  }

  return data;
}

export async function updateBetLogEntry(id, input) {
  const normalizedId = normalizeString(id, 'id');

  const updates = {};

  if (input.closing_line !== undefined) {
    updates.closing_line = input.closing_line ?? null;
  }

  if (input.clv_notes !== undefined) {
    updates.clv_notes = String(input.clv_notes ?? '').trim() || null;
  }

  if (input.result !== undefined) {
    updates.result = String(input.result ?? '').trim() || null;
  }

  if (input.payout_usd !== undefined) {
    updates.payout_usd = normalizeNumber(
      input.payout_usd,
      'payout_usd',
      { minimum: 0 }
    );
  }

  if (input.postmortem !== undefined) {
    updates.postmortem = String(input.postmortem ?? '').trim() || null;
  }

  if (input.ev_percent !== undefined) {
    updates.ev_percent = normalizeNumber(
      input.ev_percent,
      'ev_percent'
    );
  }

  if (input.fair_odds !== undefined) {
    updates.fair_odds = input.fair_odds ?? null;
  }

  if (input.kelly_percent !== undefined) {
    updates.kelly_percent = normalizeNumber(
      input.kelly_percent,
      'kelly_percent'
    );
  }

  if (input.reason !== undefined) {
    updates.reason = String(input.reason ?? '').trim() || null;
  }

  if (Object.keys(updates).length === 0) {
    throw new HttpError(400, 'No valid fields provided to update');
  }

  const { data, error } = await supabase
    .from('bet_log')
    .update(updates)
    .eq('id', normalizedId)
    .select()
    .single();

  if (error) {
    console.error('Supabase updateBetLogEntry error:', error);
    throw new HttpError(500, 'Failed to update bet log entry');
  }

  return data;
}

export async function deleteBetLogEntry(id) {
  const normalizedId = normalizeString(id, 'id');

  const { data, error } = await supabase
    .from('bet_log')
    .delete()
    .eq('id', normalizedId)
    .select('id');

  if (error) {
    console.error('Supabase deleteBetLogEntry error:', error);
    throw new HttpError(500, 'Failed to delete bet log entry');
  }

  return Array.isArray(data) && data.length > 0;
}

export async function listPostmortems() {
  const { data, error } = await supabase
    .from('postmortems')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Supabase listPostmortems error:', error);
    throw new HttpError(500, 'Failed to read postmortems');
  }

  return data || [];
}

export async function addPostmortem(input) {
  const entry = {
    id: createPostmortemId(),
    date: normalizeString(input.date, 'date'),
    summary: normalizeString(input.summary, 'summary'),
    best_decisions: Array.isArray(input.best_decisions)
      ? input.best_decisions.map((value) => String(value).trim()).filter(Boolean)
      : [],
    worst_decisions: Array.isArray(input.worst_decisions)
      ? input.worst_decisions.map((value) => String(value).trim()).filter(Boolean)
      : [],
    process_notes: Array.isArray(input.process_notes)
      ? input.process_notes.map((value) => String(value).trim()).filter(Boolean)
      : [],
    adjustments: Array.isArray(input.adjustments)
      ? input.adjustments.map((value) => String(value).trim()).filter(Boolean)
      : [],
    created_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from('postmortems')
    .insert(entry)
    .select()
    .single();

  if (error) {
    console.error('Supabase addPostmortem error:', error);
    throw new HttpError(500, 'Failed to save postmortem');
  }

  return data;
}

export async function updatePostmortem(id, input) {
  const normalizedId = normalizeString(id, 'id');

  const updates = {};

  if (input.date !== undefined) {
    updates.date = normalizeString(input.date, 'date');
  }

  if (input.summary !== undefined) {
    updates.summary = normalizeString(input.summary, 'summary');
  }

  if (input.best_decisions !== undefined) {
    updates.best_decisions = Array.isArray(input.best_decisions)
      ? input.best_decisions
          .map((value) => String(value).trim())
          .filter(Boolean)
      : [];
  }

  if (input.worst_decisions !== undefined) {
    updates.worst_decisions = Array.isArray(input.worst_decisions)
      ? input.worst_decisions
          .map((value) => String(value).trim())
          .filter(Boolean)
      : [];
  }

  if (input.process_notes !== undefined) {
    updates.process_notes = Array.isArray(input.process_notes)
      ? input.process_notes
          .map((value) => String(value).trim())
          .filter(Boolean)
      : [];
  }

  if (input.adjustments !== undefined) {
    updates.adjustments = Array.isArray(input.adjustments)
      ? input.adjustments
          .map((value) => String(value).trim())
          .filter(Boolean)
      : [];
  }

  if (Object.keys(updates).length === 0) {
    throw new HttpError(400, 'No valid fields provided to update');
  }

  const { data, error } = await supabase
    .from('postmortems')
    .update(updates)
    .eq('id', normalizedId)
    .select()
    .single();

  if (error) {
    console.error('Supabase updatePostmortem error:', error);
    throw new HttpError(500, 'Failed to update postmortem');
  }

  return data;
}

export async function deletePostmortem(id) {
  const normalizedId = normalizeString(id, 'id');

  const { data, error } = await supabase
    .from('postmortems')
    .delete()
    .eq('id', normalizedId)
    .select('id');

  if (error) {
    console.error('Supabase deletePostmortem error:', error);
    throw new HttpError(500, 'Failed to delete postmortem');
  }

  return Array.isArray(data) && data.length > 0;
}

export async function addOddsProviderUsage(input) {
  const entry = {
    provider: normalizeString(input.provider, 'provider'),
    request_type: normalizeString(input.request_type, 'request_type'),
    success: normalizeBoolean(input.success),
    fallback_used: normalizeBoolean(input.fallback_used),
    cache_hit: normalizeBoolean(input.cache_hit),
    upstream_status: normalizeNumber(
      input.upstream_status,
      'upstream_status'
    ),
    quota:
      input.quota && typeof input.quota === 'object'
        ? input.quota
        : null,
    error_message:
      String(input.error_message ?? '').trim() || null,
    created_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from('odds_provider_usage')
    .insert(entry)
    .select()
    .single();

  if (error) {
    console.error('Supabase addOddsProviderUsage error:', error);
    throw new HttpError(
      500,
      'Failed to save odds provider usage'
    );
  }

  return data;
}

export async function listOddsProviderUsage({
  since = null,
  limit = 1000
} = {}) {
  let query = supabase
    .from('odds_provider_usage')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(Math.min(Number(limit) || 1000, 5000));

  if (since) {
    query = query.gte('created_at', since);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Supabase listOddsProviderUsage error:', error);
    throw new HttpError(
      500,
      'Failed to read odds provider usage'
    );
  }

  return data || [];
}

export async function getOddsProviderUsageSummary({
  since = null
} = {}) {
  const rows = await listOddsProviderUsage({
    since,
    limit: 5000
  });

  const providers = {};

  for (const row of rows) {
    if (!providers[row.provider]) {
      providers[row.provider] = {
        requests: 0,
        successes: 0,
        failures: 0,
        fallbacks: 0,
        cache_hits: 0,
        last_request_at: null,
        last_success_at: null,
        last_failure_at: null,
        last_error: null,
        last_quota: null
      };
    }

    const provider = providers[row.provider];

    provider.requests += 1;

    if (row.success) {
      provider.successes += 1;

      if (!provider.last_success_at) {
        provider.last_success_at = row.created_at;
      }
    } else {
      provider.failures += 1;

      if (!provider.last_failure_at) {
        provider.last_failure_at = row.created_at;
        provider.last_error = row.error_message;
      }
    }

    if (row.fallback_used) {
      provider.fallbacks += 1;
    }

    if (row.cache_hit) {
      provider.cache_hits += 1;
    }

    if (!provider.last_request_at) {
      provider.last_request_at = row.created_at;
    }

    if (!provider.last_quota && row.quota) {
      provider.last_quota = row.quota;
    }
  }

  return {
    since,
    total_rows: rows.length,
    providers
  };
}

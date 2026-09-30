import { config } from '../config.js';
import { HttpError } from '../errors.js';

// Free-plan adapter. Never use its delayed prices as live/in-play odds.
const LEAGUES = {
  americanfootball_nfl: 'nfl', americanfootball_ncaaf: 'ncaaf',
  basketball_nba: 'nba', basketball_wnba: 'wnba', basketball_ncaab: 'ncaab',
  baseball_mlb: 'mlb', icehockey_nhl: 'nhl'
};
const MAX_PAGES = 6;
const PAGE_SIZE = 200;
const requests = [];
const csv = (value) => String(value || '').split(',').map((s) => s.trim()).filter(Boolean);

function unavailable(message, details = {}) {
  return new HttpError(503, message, { provider: 'sharpApi', ...details });
}

function leagueFor(sport) {
  const key = String(sport).toLowerCase();
  const league = LEAGUES[key] || (key === 'ncaam' ? 'ncaab' : key);
  if (!Object.values(LEAGUES).includes(league)) {
    throw unavailable(`SharpAPI adapter does not support sport "${sport}"; use another provider.`);
  }
  return league;
}

function validateParams(params) {
  if (String(params.live) === 'true' || String(params.is_live) === 'true') {
    throw unavailable('SharpAPI free-plan adapter supports pregame only; use another provider for live odds.');
  }
  if (params.regions && csv(params.regions).some((r) => r !== 'us')) {
    throw unavailable('SharpAPI free-plan adapter supports US sportsbooks only.');
  }
  if (params.bookmakers && csv(params.bookmakers).some((b) => !['draftkings', 'fanduel'].includes(b))) {
    throw unavailable('SharpAPI free plan supports DraftKings and FanDuel only; use another provider for the requested books.');
  }
  for (const [key, choices] of [['oddsFormat', ['american', 'decimal']], ['dateFormat', ['iso', 'unix']]]) {
    if (params[key] && !choices.includes(params[key])) throw new HttpError(400, `Invalid ${key}`);
  }
  const from = params.commenceTimeFrom ? Date.parse(params.commenceTimeFrom) : null;
  const to = params.commenceTimeTo ? Date.parse(params.commenceTimeTo) : null;
  if ((from !== null && !Number.isFinite(from)) || (to !== null && !Number.isFinite(to)) || (from !== null && to !== null && from > to)) {
    throw new HttpError(400, 'Invalid commenceTimeFrom/commenceTimeTo window.');
  }
  return { from, to };
}

function inWindow(value, bounds) {
  const time = Date.parse(value);
  return Number.isFinite(time) && (bounds.from === null || time >= bounds.from) && (bounds.to === null || time <= bounds.to);
}

function formatTime(value, params) {
  return params.dateFormat === 'unix' ? Math.floor(Date.parse(value) / 1000) : value;
}

function marketPlan(league, params) {
  const spread = league === 'mlb' ? 'run_line' : league === 'nhl' ? 'puck_line' : 'point_spread';
  const total = league === 'mlb' ? 'total_runs' : league === 'nhl' ? 'total_goals' : 'total_points';
  const mapping = { h2h: 'moneyline', spreads: spread, totals: total,
    alternate_spreads: spread, alternate_totals: total };
  const keys = csv(params.markets || 'h2h,spreads,totals');
  if (!keys.length) throw new HttpError(400, 'At least one market is required.');
  const plan = keys.map((key) => {
    // Exact, named player markets preserve their identity. Do not guess aliases
    // such as pitcher_strikeouts, or normalize opaque player_prop/game_prop rows.
    const type = mapping[key] || (/^player_[a-z0-9_]+$/.test(key) && key !== 'player_prop' ? key : null);
    if (!type) throw unavailable(`SharpAPI adapter has no verified mapping for market "${key}"; use another provider.`);
    return { key, type, alternate: key.startsWith('alternate_'), core: Boolean(mapping[key]) };
  });
  return plan;
}

async function call(path, params) {
  const settings = config.oddsProviders.sharpApi;
  if (!settings.enabled || !settings.apiKey || settings.apiKey === 'replace_me') {
    throw unavailable('SHARP_API_KEY is not configured or SharpAPI is disabled.');
  }
  const now = Date.now();
  while (requests.length && requests[0] <= now - 60000) requests.shift();
  if (requests.length >= 12) {
    throw unavailable('SharpAPI free-plan request budget reached; try another provider.', {
      upstreamStatus: 429, retryAfter: Math.max(1, Math.ceil((requests[0] + 60000 - now) / 1000))
    });
  }
  requests.push(now);
  const url = new URL(`/api/v1/${path}`, settings.baseUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.oddsRequestTimeoutMs);
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'X-API-Key': settings.apiKey },
      signal: controller.signal,
      redirect: 'error'
    });
    // Never forward raw upstream errors: a provider could echo credentials.
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const rawRetry = response.headers.get('retry-after') || body?.error?.retry_after;
      const numericRetry = Number(rawRetry);
      const retryAfter = rawRetry && Number.isFinite(numericRetry) && numericRetry > 0 ? numericRetry : 60;
      throw new HttpError(502, 'SharpAPI upstream request failed', {
        provider: 'sharpApi', upstreamStatus: response.status, retryAfter
      });
    }
    if (!body || !Array.isArray(body.data)) throw unavailable('SharpAPI returned an invalid data response.');
    if (['warming', 'store_empty'].includes(body.meta?.store?.reason)) {
      throw unavailable('SharpAPI feed is not ready; use another provider.');
    }
    const delayHeader = response.headers.get('x-data-delay');
    const delay = delayHeader === null ? NaN : Number.parseFloat(delayHeader);
    return { body, quota: {
      limit: response.headers.get('x-ratelimit-limit'),
      remaining: response.headers.get('x-ratelimit-remaining'),
      reset: response.headers.get('x-ratelimit-reset')
    }, delay: Number.isFinite(delay) ? Math.max(60, delay) : 60 };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, 'SharpAPI request failed or timed out', { provider: 'sharpApi', upstreamStatus: 0 });
  } finally {
    clearTimeout(timeout);
  }
}

async function pages(path, params) {
  const rows = [];
  let cursor;
  let offset = 0;
  let last;
  let delay = 60;
  const seen = new Set();
  for (let page = 0; page < MAX_PAGES; page++) {
    last = await call(path, { ...params, limit: PAGE_SIZE, ...(cursor ? { cursor } : { offset }) });
    rows.push(...last.body.data);
    delay = Math.max(delay, last.delay);
    const pagination = last.body.pagination;
    if (!pagination || typeof pagination.has_more !== 'boolean') {
      throw unavailable('SharpAPI pagination is missing; refusing a possibly incomplete response.');
    }
    if (!pagination.has_more) return { rows, quota: last.quota, delay };
    const next = path === 'odds' ? pagination.next_cursor : pagination.next_offset;
    if (next === undefined || next === null || next === '' || seen.has(String(next))) {
      throw unavailable('SharpAPI pagination could not be completed.');
    }
    seen.add(String(next));
    if (path === 'odds') cursor = next;
    else {
      if (!Number.isInteger(next) || next <= offset) throw unavailable('SharpAPI returned an invalid next offset.');
      offset = next;
    }
  }
  throw unavailable('SharpAPI response exceeds the free-plan page budget; narrow the request or use another provider.');
}

function envelope(data, source, extra = {}) {
  return { provider: 'sharpApi', data, quota: source.quota, meta: {
    coverage: 'pregame_betting_events', complete_schedule: false,
    data_delay_seconds: source.delay, fetched_at: new Date().toISOString(),
    note: 'SharpAPI Free: DraftKings/FanDuel, delayed pregame data. Verify the sportsbook price before betting. Scores and live odds are not supplied by this adapter.',
    ...extra
  } };
}

async function getEvents(sport, params = {}) {
  const league = leagueFor(sport);
  const bounds = validateParams(params);
  const source = await pages('events', { league, status: 'upcoming', live: false, sportsbook: params.bookmakers });
  const events = new Map();
  for (const row of source.rows) {
    if (row.is_live || row.status === 'live' || row.status === 'final') continue;
    if (!row.id || !row.home_team || !row.away_team || !Number.isFinite(Date.parse(row.start_time))) {
      throw unavailable('SharpAPI returned an incomplete event.');
    }
    if (row.league && row.league !== league) continue;
    if (!inWindow(row.start_time, bounds) || Date.parse(row.start_time) <= Date.now()) continue;
    events.set(row.id, { id: row.id, provider_event_id: row.id, sport_key: sport,
      home_team: row.home_team, away_team: row.away_team,
      commence_time: formatTime(row.start_time, params), status: 'Upcoming' });
  }
  if (!events.size) throw unavailable('SharpAPI has no matching pregame events; try another provider.');
  return envelope([...events.values()], source);
}

async function getOdds(sport, params = {}, eventId = null) {
  const league = leagueFor(sport);
  const bounds = validateParams(params);
  const plan = marketPlan(league, params);
  const requestedIds = csv(eventId || params.eventIds);
  const requestedBooks = csv(params.bookmakers || 'draftkings,fanduel');
  const coreOnly = plan.every((p) => p.core && !p.alternate);
  const alternateOnly = plan.every((p) => p.alternate);
  const source = await pages('odds', { league,
    market: [...new Set(plan.map((p) => p.type))].join(','),
    sportsbook: params.bookmakers, event_id: eventId || params.eventIds,
    is_live: false, ...(coreOnly ? { is_main_line: true } : {}),
    ...(alternateOnly ? { is_alternate_line: true } : {})
  });
  const events = new Map();
  const foundMarkets = new Set();
  for (const row of source.rows) {
    if (row.is_live || row.is_active === false || row.is_stale_pregame_price || row.event_status === 'final') continue;
    if (row.league && row.league !== league) continue;
    if (!requestedBooks.includes(row.sportsbook)) continue;
    if (requestedIds.length && !requestedIds.includes(row.event_id) && !requestedIds.includes(row.event_uuid)) continue;
    if (!inWindow(row.event_start_time, bounds) || Date.parse(row.event_start_time) <= Date.now()) continue;
    const match = plan.find((p) => p.type === row.market_type &&
      (!p.core || (p.alternate ? row.is_alternate_line === true : row.is_main_line === true)));
    if (!match) continue;
    const price = params.oddsFormat === 'decimal' ? row.odds_decimal : row.odds_american;
    if (typeof price !== 'number' || !Number.isFinite(price) ||
      (params.oddsFormat === 'decimal' ? price <= 1 : Math.abs(price) < 100)) continue;
    const isProp = match.type.startsWith('player_');
    if (isProp && !row.player_name) continue;
    const lineRequired = match.key !== 'h2h';
    if (lineRequired && (typeof row.line !== 'number' || !Number.isFinite(row.line))) continue;
    if (!row.event_id || !row.home_team || !row.away_team || !row.selection || !row.sportsbook || !Number.isFinite(Date.parse(row.timestamp))) continue;
    if (Date.now() - Date.parse(row.timestamp) > 5 * 60 * 1000) continue;
    // Each outcome retains its feed timestamp; this is not a line-movement time.
    const id = eventId || row.event_id;
    if (!events.has(id)) events.set(id, { id, provider_event_id: id, sport_key: sport,
      commence_time: formatTime(row.event_start_time, params), home_team: row.home_team,
      away_team: row.away_team, bookmakers: [] });
    const event = events.get(id);
    let book = event.bookmakers.find((b) => b.key === row.sportsbook);
    if (!book) {
      book = { key: row.sportsbook, title: row.sportsbook === 'draftkings' ? 'DraftKings' : row.sportsbook === 'fanduel' ? 'FanDuel' : row.sportsbook, markets: [] };
      event.bookmakers.push(book);
    }
    let market = book.markets.find((m) => m.key === match.key);
    if (!market) {
      market = { key: match.key, outcomes: [] };
      book.markets.push(market);
    }
    const outcome = { name: row.selection, price, last_update: row.timestamp,
      ...(row.line !== null && row.line !== undefined ? { point: row.line } : {}),
      ...(isProp ? { description: row.player_name } : {}) };
    const duplicate = market.outcomes.findIndex((o) => o.name === outcome.name && o.point === outcome.point && o.description === outcome.description);
    if (duplicate < 0) market.outcomes.push(outcome);
    else if (Date.parse(outcome.last_update) > Date.parse(market.outcomes[duplicate].last_update)) market.outcomes[duplicate] = outcome;
    foundMarkets.add(match.key);
  }
  if (!events.size) throw unavailable('SharpAPI has no usable odds for this request; try another provider.');
  const missing = plan.filter((p) => !foundMarkets.has(p.key)).map((p) => p.key);
  if (missing.length) throw unavailable(`SharpAPI has no usable odds for requested markets: ${missing.join(', ')}. Try another provider.`);
  return envelope(eventId ? [...events.values()][0] : [...events.values()], source, {
    requested_markets: plan.map((p) => p.key),
    odds_format: params.oddsFormat || 'american',
    event_market_coverage: 'Markets and books can vary by event; absence is not evidence that a market does not exist.'
  });
}

export const sharpApiProvider = {
  getEvents,
  getOddsBoard: getOdds,
  getEventOdds(sport, eventId, params = {}) { return getOdds(sport, params, eventId); },
  getSports() { throw unavailable('SharpAPI adapter does not supply the complete sports catalogue; use another provider.'); },
  getScores() { throw unavailable('SharpAPI Free does not supply scores; use another provider.'); }
};

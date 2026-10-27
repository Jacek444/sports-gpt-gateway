import { HttpError } from '../errors.js';

const csv = value => [...new Set(String(value || '').split(',').map(s => s.trim()).filter(Boolean))].sort();
const iso = value => typeof value === 'string' && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
const token = value => /^[a-zA-Z0-9_-]+$/.test(value);
const fail = message => { throw new HttpError(400, message); };

// Validate and bound the complete request before any upstream credits are spent.
export function historyRequest(sport, input, now = Date.now()) {
  if (!token(sport)) fail('Use an exact Odds API sport key');
  if (!iso(input.date) || Date.parse(input.date) > now) fail('date must be a past ISO timestamp with timezone');
  const type = input.type || 'odds';
  if (!['odds', 'events', 'event_odds'].includes(type)) fail('Invalid historical request type');
  let eventId = input.event_id || null;
  if (eventId?.startsWith('theOddsApi:')) eventId = eventId.slice(11);
  if (eventId && !token(eventId)) fail('Use the original The Odds API event ID; rediscover IDs from other providers');
  if (type === 'event_odds' && !eventId) fail('event_id is required for historical event odds');
  const markets = csv(input.markets || 'h2h');
  const regions = csv(input.regions || 'us');
  const books = csv(input.bookmakers);
  if ([...markets, ...regions, ...books].some(v => !token(v))) fail('Invalid market, region, or bookmaker key');
  if (type === 'odds' && markets.some(m => !['h2h', 'spreads', 'totals'].includes(m))) fail('Props and period markets require type=event_odds');
  const estimate = type === 'events' ? 1 : 10 * markets.length * (books.length ? Math.ceil(books.length / 10) : regions.length);
  const max = Number(input.max_credits ?? 30);
  if (!Number.isInteger(max) || max < 1 || max > 100) fail('max_credits must be between 1 and 100');
  if (estimate > max) fail(`Historical request estimate ${estimate} credits exceeds max_credits=${max}`);
  const params = { date: new Date(input.date).toISOString(), oddsFormat: 'american' };
  if (type !== 'events') {
    params.markets = markets.join(',');
    if (books.length) params.bookmakers = books.join(',');
    else params.regions = regions.join(',');
  }
  return { sport, type, eventId, params, estimated_credits: estimate };
}

export async function fetchHistory(request, run) {
  const { sport, type, eventId, params } = request;
  const method = type === 'events' ? 'getHistoricalEvents' : type === 'event_odds' ? 'getHistoricalEventOdds' : 'getHistoricalOdds';
  const result = await run('theOddsApi', provider => type === 'event_odds'
    ? provider[method](sport, eventId, params) : provider[method](sport, params), {
    cacheKey: `history:${JSON.stringify(request)}`,
    cacheTtlMs: 24 * 60 * 60 * 1000,
    requestType: `historical_${type}`
  });
  return { ...result, estimated_credits: request.estimated_credits,
    actual_credits: result.cache?.hit ? 0 : (result.quota?.last != null && Number.isFinite(Number(result.quota.last)) ? Number(result.quota.last) : null),
    snapshot_note: 'Point-in-time archive; not a guarantee of the exact final closing price. Cache is process-local and resets on deploy.' };
}

export function prepareClv(bets, maxCredits = 100, now = Date.now()) {
  if (!Array.isArray(bets) || !bets.length || bets.length > 50) fail('bets must contain 1–50 wagers');
  if (!Number.isInteger(maxCredits) || maxCredits < 1 || maxCredits > 100) fail('max_credits must be between 1 and 100');
  const groups = new Map();
  const prepared = bets.map((bet, index) => {
    const start = Date.parse(bet.commence_time);
    if (!iso(bet.commence_time) || start > now) fail(`Bet ${index}: past commence_time with timezone required`);
    const odds = Number(bet.taken_odds ?? bet.odds);
    if (!Number.isFinite(odds) || Math.abs(odds) < 100) fail(`Bet ${index}: valid American taken_odds required`);
    const market = bet.market_key || bet.market;
    const book = bet.bookmaker_key || bet.bookmaker || bet.sportsbook;
    const outcome = bet.outcome_key || bet.outcome || bet.selection;
    if (!market || csv(market).length !== 1 || !book || csv(book).length !== 1 || !outcome) fail(`Bet ${index}: exact market_key, bookmaker_key and outcome required`);
    if (market.startsWith('player_') && !bet.player) fail(`Bet ${index}: player required for player markets`);
    const lineRequired = market !== 'h2h' && !market.startsWith('h2h_');
    if (lineRequired && (bet.line == null || bet.line === '' || !Number.isFinite(Number(bet.line)))) fail(`Bet ${index}: numeric line required`);
    const request = historyRequest(bet.sport_key, { type: 'event_odds', event_id: bet.gateway_event_id || (bet.odds_provider === 'theOddsApi' ? bet.provider_event_id : null),
      date: new Date(start - 1000).toISOString(), markets: market, bookmakers: book, max_credits: maxCredits }, now);
    const key = JSON.stringify(request);
    groups.set(key, request);
    return { bet, index, key, start, market, book, outcome, odds };
  });
  const estimate = [...groups.values()].reduce((sum, r) => sum + r.estimated_credits, 0);
  if (estimate > maxCredits) fail(`CLV batch estimate ${estimate} credits exceeds max_credits=${maxCredits}; split the batch`);
  return { prepared, groups, estimated_credits: estimate };
}

const decimal = price => price > 0 ? 1 + price / 100 : 1 + 100 / Math.abs(price);
export function gradeSnapshot(item, result) {
  const { bet, start, market, book, outcome, odds } = item;
  const archive = result.data;
  const event = archive?.data;
  const snapshot = Date.parse(archive?.timestamp);
  const missing = reason => ({ status: 'unmatched', reason, log_update: null });
  // Reject wrong fixtures, in-play data and old snapshots rather than inventing CLV.
  if (!Number.isFinite(snapshot) || snapshot >= start || start - snapshot > 15 * 60000) return missing('No archive snapshot within 15 minutes before scheduled start');
  const requestedId = item.bet.gateway_event_id?.replace(/^theOddsApi:/, '') || bet.provider_event_id;
  if (!event || event.id !== requestedId || Date.parse(event.commence_time) !== start ||
    (bet.home_team && bet.home_team !== event.home_team) || (bet.away_team && bet.away_team !== event.away_team)) return missing('Fixture or scheduled start mismatch');
  const bookmaker = event.bookmakers?.find(b => b.key === book);
  const m = bookmaker?.markets?.find(m => m.key === market);
  const updated = m?.last_update || bookmaker?.last_update;
  const quoteTime = Date.parse(updated);
  if (!Number.isFinite(quoteTime) || quoteTime >= start || quoteTime > snapshot || start - quoteTime > 15 * 60000) return missing('Missing, stale or non-pregame quote timestamp');
  const candidates = (m?.outcomes || []).filter(o => o.name === outcome && (!bet.player || o.description === bet.player));
  const hasLine = bet.line != null && bet.line !== '';
  const exact = candidates.filter(o => !hasLine || o.point === Number(bet.line));
  const matches = exact.length ? exact : candidates;
  if (matches.length !== 1) return missing('Missing or ambiguous exact selection');
  const quote = matches[0];
  if (!Number.isFinite(quote.price) || Math.abs(quote.price) < 100) return missing('Invalid American closing quote');
  const sameLine = !hasLine || quote.point === Number(bet.line);
  const percent = sameLine ? Math.round((decimal(odds) / decimal(quote.price) - 1) * 10000) / 100 : null;
  const status = sameLine ? 'pregame_snapshot_same_line' : 'pregame_snapshot_line_changed';
  return { status, snapshot_timestamp: archive.timestamp, quote_timestamp: updated,
    log_update: { closing_odds: String(quote.price), closing_line: quote.point ?? null, closing_book: book,
      clv_percent: percent, clv_status: status,
      clv_notes: `source=theOddsApi; snapshot=${archive.timestamp}; quote=${updated}; scheduled_start=${bet.commence_time}; market=${market}; metric=${sameLine ? 'decimal_price_ratio_same_line' : 'line_changed_no_price_clv'}; pregame snapshot proxy, not verified exact close; not no-vig EV` } };
}

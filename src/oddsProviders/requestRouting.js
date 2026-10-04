const csv = value => String(value || '').split(',').map(v => v.trim()).filter(Boolean);
const coreMarkets = new Set(['h2h', 'spreads', 'totals']);

// These are adapter restrictions, not guesses about upstream paid plans.
export function oddsRequestOrder(params, { defaultOrder, betmgmOrder }) {
  const books = csv(params.bookmakers);
  const markets = csv(params.markets || 'h2h,spreads,totals');
  const order = books.includes('betmgm') && markets.every(m => coreMarkets.has(m))
    ? [...betmgmOrder, ...defaultOrder] : defaultOrder;
  return [...new Set(order)].filter(name => {
    if (['sharpApi', 'moneyline'].includes(name) && books.some(b => !['draftkings', 'fanduel'].includes(b))) return false;
    if (name === 'moneyline' && markets.some(m => !coreMarkets.has(m))) return false;
    if (name === 'sharpApi' && markets.some(m => !coreMarkets.has(m) && !['alternate_spreads', 'alternate_totals'].includes(m) && !/^player_[a-z0-9_]+$/.test(m))) return false;
    return true;
  });
}

// An HTTP success with no requested quotes must not stop automatic fallback.
// This checks coverage, not freshness or whether a quote is executable.
export function hasRequestedQuotes(result, params) {
  const rows = Array.isArray(result?.data) ? result.data : result?.data ? [result.data] : [];
  const books = csv(params.bookmakers);
  const wanted = csv(params.markets || 'h2h,spreads,totals');
  return books.length ? books.every(book => covered(book)) : covered(null);

  function covered(book) {
    const found = new Set(rows.flatMap(event => (event.bookmakers || [])
      .filter(b => !book || b.key === book)
      .flatMap(b => (b.markets || []).filter(m => (m.outcomes || []).some(o =>
        typeof o.price === 'number' && Number.isFinite(o.price) &&
        (params.oddsFormat === 'decimal' ? o.price > 1 : Math.abs(o.price) >= 100)))
        .map(m => m.key))));
    return wanted.every(m => m === 'team_totals'
      ? [...found].some(k => k.startsWith('team_total_') || k === 'team_totals')
      : found.has(m));
  }
}

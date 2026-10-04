import test from 'node:test';
import assert from 'node:assert/strict';
import { oddsRequestOrder, hasRequestedQuotes } from '../src/oddsProviders/requestRouting.js';

const orders = {
  defaultOrder: ['sharpApi', 'oddsPapi', 'moneyline', 'sportsGameOdds', 'parlayApi', 'theOddsApi'],
  betmgmOrder: ['parlayApi', 'oddsPapi', 'sportsGameOdds', 'theOddsApi']
};
test('BetMGM core requests prefer ParlayAPI and skip known unsupported adapters', () => {
  assert.deepEqual(oddsRequestOrder({ bookmakers: 'betmgm', markets: 'h2h,totals' }, orders), orders.betmgmOrder);
  assert.deepEqual(oddsRequestOrder({ bookmakers: 'betmgm,draftkings' }, orders), orders.betmgmOrder);
});
test('DraftKings and unspecified books preserve configured ordering', () => {
  assert.deepEqual(oddsRequestOrder({ bookmakers: 'draftkings' }, orders), orders.defaultOrder);
  assert.deepEqual(oddsRequestOrder({}, orders), orders.defaultOrder);
});
test('F5 does not assume ParlayAPI coverage; explicit preference can be customized', () => {
  assert.deepEqual(oddsRequestOrder({ bookmakers: 'betmgm', markets: 'f5_total' }, orders), ['oddsPapi', 'sportsGameOdds', 'parlayApi', 'theOddsApi']);
  assert.equal(oddsRequestOrder({ bookmakers: 'betmgm', markets: 'h2h' }, { ...orders, betmgmOrder: ['sportsGameOdds'] })[0], 'sportsGameOdds');
});
const board = (book, markets) => ({ data: [{ bookmakers: [{ key: book, markets: markets.map(key => ({ key, outcomes: [{ name: 'Home', price: -110 }] })) }] }] });
test('empty, wrong-book and missing-market successes cannot end fallback', () => {
  const params = { bookmakers: 'betmgm', markets: 'h2h,totals' };
  assert.equal(hasRequestedQuotes({ data: [] }, params), false);
  assert.equal(hasRequestedQuotes(board('draftkings', ['h2h', 'totals']), params), false);
  assert.equal(hasRequestedQuotes(board('betmgm', ['h2h']), params), false);
  assert.equal(hasRequestedQuotes(board('betmgm', ['h2h', 'totals']), params), true);
});
test('each requested book must cover the requested market; invalid prices are excluded', () => {
  assert.equal(hasRequestedQuotes(board('betmgm', ['h2h']), { bookmakers: 'betmgm,fanduel', markets: 'h2h' }), false);
  const result = board('betmgm', ['h2h']);
  result.data[0].bookmakers[0].markets[0].outcomes[0].price = 0;
  assert.equal(hasRequestedQuotes(result, { markets: 'h2h' }), false);
  result.data[0].bookmakers[0].markets[0].outcomes[0].price = 1.9;
  assert.equal(hasRequestedQuotes(result, { markets: 'h2h', oddsFormat: 'decimal' }), true);
});

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError } from './errors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../data');

const FILES = {
  betLog: path.join(DATA_DIR, 'bet-log.json'),
  postmortems: path.join(DATA_DIR, 'postmortems.json')
};

async function ensureDataDir() {
  await mkdir(DATA_DIR, { recursive: true });
}

async function readJson(filePath, fallback) {
  await ensureDataDir();

  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') {
      await writeJson(filePath, fallback);
      return fallback;
    }

    throw new HttpError(500, `Failed to read storage file ${path.basename(filePath)}`);
  }
}

async function writeJson(filePath, value) {
  await ensureDataDir();
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

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
    throw new HttpError(400, `Field "${fieldName}" must be at least ${minimum}`);
  }

  return number;
}

function normalizeBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

export async function listBetLogEntries() {
  const payload = await readJson(FILES.betLog, { entries: [] });
  return payload.entries || [];
}

export async function addBetLogEntry(input) {
  const payload = await readJson(FILES.betLog, { entries: [] });

  const entry = {
    id: `bet_${Date.now()}`,
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
    result: String(input.result ?? '').trim() || null,
    payout_usd: normalizeNumber(input.payout_usd, 'payout_usd', { minimum: 0 }),
    closing_line: input.closing_line ?? null,
    clv_notes: String(input.clv_notes ?? '').trim() || null,
    postmortem: String(input.postmortem ?? '').trim() || null,
    created_at: new Date().toISOString()
  };

  payload.entries.unshift(entry);
  await writeJson(FILES.betLog, payload);
  return entry;
}

export async function listPostmortems() {
  const payload = await readJson(FILES.postmortems, { entries: [] });
  return payload.entries || [];
}

export async function addPostmortem(input) {
  const payload = await readJson(FILES.postmortems, { entries: [] });

  const entry = {
    id: `postmortem_${Date.now()}`,
    date: normalizeString(input.date, 'date'),
    summary: normalizeString(input.summary, 'summary'),
    best_decisions: Array.isArray(input.best_decisions) ? input.best_decisions.map((value) => String(value).trim()).filter(Boolean) : [],
    worst_decisions: Array.isArray(input.worst_decisions) ? input.worst_decisions.map((value) => String(value).trim()).filter(Boolean) : [],
    process_notes: Array.isArray(input.process_notes) ? input.process_notes.map((value) => String(value).trim()).filter(Boolean) : [],
    adjustments: Array.isArray(input.adjustments) ? input.adjustments.map((value) => String(value).trim()).filter(Boolean) : [],
    created_at: new Date().toISOString()
  };

  payload.entries.unshift(entry);
  await writeJson(FILES.postmortems, payload);
  return entry;
}

# Sports GPT Gateway

This starter gives you two things:

1. A small backend that normalizes live sports data across `NBA`, `NFL`, `NCAAM`, `NCAAF`, `MLB`, and `NHL`
2. An OpenAPI schema you can use as a Custom GPT Action

It now also includes a simple file-backed betting history backend so you can stop re-uploading logs once you deploy it.

It also now includes a small The Odds API proxy, so your GPT can pull odds and scores through your own backend instead of trying to authenticate directly against The Odds API from the GPT builder.

The backend is designed so the GPT only sees one stable contract, even if you switch providers later.

## Why this shape

The GPT should not need to know vendor-specific endpoints, field names, or league quirks. This gateway normalizes:

- game status
- teams
- scores
- standings
- league-specific fields like week and season

The default adapter is `BALLDONTLIE` because it currently covers all requested leagues and publishes AI-friendly docs and OpenAPI references. A `SportsDataIO` adapter shell is included so you can swap providers without changing the GPT Action schema.

## Project layout

- `src/server.js`: Express API
- `src/leagues.js`: supported leagues and metadata
- `src/providers/ballDontLieProvider.js`: working provider adapter
- `src/providers/sportsDataIoProvider.js`: adapter shell for future wiring
- `src/providers/mockProvider.js`: fallback for local schema testing
- `openapi/sports-gpt-actions.yaml`: Custom GPT Actions schema

## Endpoints

- `GET /health`
- `GET /v1/leagues`
- `GET /v1/games?league=NBA&date=2026-03-22`
- `GET /v1/games/:league/:gameId`
- `GET /v1/teams?league=NFL&search=chiefs`
- `GET /v1/standings?league=MLB&season=2025`
- `GET /v1/logs/bet-log`
- `POST /v1/logs/bet-log`
- `GET /v1/logs/postmortems`
- `POST /v1/logs/postmortems`
- `GET /v1/odds/sports`
- `GET /v1/odds/:sport/odds`
- `GET /v1/odds/:sport/scores`
- `GET /v1/odds/:sport/events`
- `GET /v1/odds/:sport/events/:eventId/odds`

## Quick start

1. Install Node 20+
2. Copy `.env.example` to `.env`
3. Set `BALLDONTLIE_API_KEY`
4. If you want The Odds API through your own backend, also set `ODDS_API_KEY`
4. Install dependencies:

```bash
npm install
```

5. Start the server:

```bash
npm run dev
```

6. Expose the server on HTTPS for GPT Actions

If you do not have a public server yet, use a tunnel such as `ngrok` or deploy to Render, Railway, Fly.io, or Vercel with a small Node service.

## The Odds API proxy

The GPT builder did not reliably authenticate directly against The Odds API in this setup, so this project now includes a proxy route set:

- `GET /v1/odds/sports`
- `GET /v1/odds/{sport}/odds`
- `GET /v1/odds/{sport}/scores`
- `GET /v1/odds/{sport}/events`
- `GET /v1/odds/{sport}/events/{eventId}/odds`

These routes call The Odds API on the server side using:

```env
ODDS_API_KEY=your_key_here
```

Use the GPT action schema:

- `openapi/odds-proxy-actions.yaml`

This version does not require a GPT-side secret because the API key lives on your server.

## File-backed betting log backend

This starter now includes two JSON-backed files:

- `data/bet-log.json`
- `data/postmortems.json`

Those files are read and written through API endpoints:

- `GET /v1/logs/bet-log`
- `POST /v1/logs/bet-log`
- `GET /v1/logs/postmortems`
- `POST /v1/logs/postmortems`

That means once you deploy the backend, your GPT can read and write betting history through the API instead of relying only on uploaded Knowledge files.

### Easy path

1. Build and test your GPT now using Knowledge files only
2. Later deploy this backend
3. Turn Actions back on
4. Import the updated `openapi/sports-gpt-actions.yaml`
5. Let the GPT read/write your log entries through `/v1/logs/...`

### Example bet-log POST body

```json
{
  "date": "2026-03-22",
  "sport": "Basketball",
  "league": "NCAAM",
  "event": "Kentucky vs Iowa State",
  "market": "Spread",
  "selection": "Kentucky -1.5",
  "line": "-1.5",
  "odds": "-105",
  "sportsbook": "DraftKings",
  "stake_usd": 5,
  "units": 1,
  "is_bonus_bet": false,
  "boost_used": false,
  "ev_percent": 3.4,
  "reason": "Market overreacted to Iowa State's early steam"
}
```

### Example postmortem POST body

```json
{
  "date": "2026-03-22",
  "summary": "Small-card day. Good discipline, but one alt-line leg was overpriced.",
  "best_decisions": ["Kept parlays to 2 legs"],
  "worst_decisions": ["Used one expensive alternate spread"],
  "process_notes": ["Stayed above 3% EV threshold"],
  "adjustments": ["Reduce alt-line usage next slate"]
}
```

## Custom GPT setup

In your Custom GPT:

1. Open `Actions`
2. Import `openapi/sports-gpt-actions.yaml`
3. Replace the server URL in the schema with your public HTTPS URL
4. If your deployment requires auth, add the auth scheme in the GPT action config

## Recommended GPT instructions

Use these rules in your GPT instructions:

```text
You can retrieve live and recent sports data through the Sports GPT Gateway action.

When the user asks about scores, schedules, standings, or live game state for NBA, NFL, NCAA men's basketball, NCAA football, MLB, or NHL:
- Call the gateway instead of guessing.
- Prefer /v1/games for schedules and live scores.
- Prefer /v1/standings for rankings or division/conference tables.
- If the user names a team but not a league, clarify only when necessary; otherwise infer from context.
- Always cite the league and game date in your answer.
- If live data is unavailable from the provider, say so explicitly rather than inventing a score.
```

## Provider notes

### BALLDONTLIE

The current implementation uses BALLDONTLIE endpoint patterns documented on their official docs:

- NBA: `/v1/...`
- NFL: `/nfl/v1/...`
- NCAAF: `/ncaaf/v1/...`
- NCAAB: `/ncaab/v1/...`
- MLB: `/mlb/v1/...`
- NHL: `/nhl/v1/...`

The adapter normalizes those responses into a shared contract.

Official references used:

- [BALLDONTLIE docs](https://www.balldontlie.io/docs)
- [NBA API docs](https://nba.balldontlie.io/)
- [NFL API docs](https://nfl.balldontlie.io/)
- [NCAAF API docs](https://ncaaf.balldontlie.io/)
- [NCAAB API docs](https://ncaab.balldontlie.io/)
- [MLB API docs](https://mlb.balldontlie.io/)
- [NHL API docs](https://nhl.balldontlie.io/)

### SportsDataIO

The SportsDataIO adapter is intentionally left as an implementation shell because endpoint selection depends on the feed tier you buy, such as basic scores vs live game state. The abstraction boundary is already in place, so you can map their feeds into the same normalized contract without changing the GPT Action schema.

Official references used:

- [SportsDataIO APIs](https://sportsdata.io/apis)
- [API resources](https://sportsdata.io/developers/apis)
- [NBA workflow guide](https://sportsdata.io/developers/workflow-guide/nba)
- [NFL API documentation](https://sportsdata.io/developers/api-documentation/nfl)

## Normalized response contract

### Game

```json
{
  "id": "7001",
  "league": "NFL",
  "provider": "balldontlie",
  "season": 2025,
  "week": 18,
  "start_time": "2026-01-04T18:00:00.000Z",
  "status": {
    "code": "live",
    "display": "3rd Qtr",
    "is_live": true,
    "period": 3,
    "clock": "09:41"
  },
  "home_team": {
    "id": "14",
    "name": "Kansas City Chiefs",
    "abbreviation": "KC"
  },
  "away_team": {
    "id": "6",
    "name": "Baltimore Ravens",
    "abbreviation": "BAL"
  },
  "score": {
    "home": 24,
    "away": 17
  }
}
```

### Standing row

```json
{
  "team": {
    "id": "21",
    "name": "Washington Commanders",
    "abbreviation": "WSH"
  },
  "wins": 5,
  "losses": 2,
  "ties": 0,
  "pct": 0.714,
  "rank": 2,
  "conference": "NFC",
  "division": "EAST",
  "streak": "W1"
}
```

## Live data strategy

For GPT usage, polling is usually enough:

- `games`: poll every 20 to 60 seconds during live windows
- `standings`: poll every 5 to 15 minutes
- `teams`: cache for 24 hours

If you later want lower latency, add a webhook ingestion layer and a cache:

1. Provider webhook or poller writes raw events into Redis
2. Normalizer builds a stable game snapshot
3. GPT gateway reads from Redis first, provider second

BALLDONTLIE currently documents webhooks for some sports, but not all of the leagues you asked for. For the six-league setup here, the simplest reliable version is polling plus short-lived caching.

## Next changes I would make

1. Add Redis caching
2. Add webhook ingestion where available
3. Finish the SportsDataIO adapter for your purchased feed set
4. Add auth before exposing the gateway publicly

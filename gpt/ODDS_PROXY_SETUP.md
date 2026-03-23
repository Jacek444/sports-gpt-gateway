# Odds Proxy Setup

This is the reliable version.

Your GPT will **not** call `api.the-odds-api.com` directly.

Instead:

1. Your backend stores your `ODDS_API_KEY`
2. Your backend calls The Odds API
3. Your GPT calls your backend

That avoids the authentication problem you just hit in the GPT builder.

## Files to use

- OpenAPI action file:
  - `openapi/odds-proxy-actions.yaml`
- Env example:
  - `.env.example`

## What you need to do

1. Copy `.env.example` to `.env`
2. Put your real The Odds API key in:

```env
ODDS_API_KEY=your_real_key_here
```

3. Install Node.js 20+
4. Run:

```bash
npm install
npm run dev
```

5. Deploy this app to a public HTTPS URL later, such as Render or Railway
6. In the GPT builder, import:

`openapi/odds-proxy-actions.yaml`

7. Replace the server URL in that file with your public deployed backend URL
8. Import the file into GPT Actions

## Important

This proxy action does **not** need a GPT-side API key.

The key lives on your server in `.env`.

## Endpoints your GPT will get

- `GET /v1/odds/sports`
- `GET /v1/odds/{sport}/odds`
- `GET /v1/odds/{sport}/scores`
- `GET /v1/odds/{sport}/events`
- `GET /v1/odds/{sport}/events/{eventId}/odds`

## Best sports for you

- NFL: `americanfootball_nfl`
- NCAA Football: `americanfootball_ncaaf`
- NBA: `basketball_nba`
- NCAA Men's Basketball: `basketball_ncaab`
- MLB: `baseball_mlb`
- NHL: `icehockey_nhl`

## Best beginner defaults

- `regions=us`
- `markets=h2h,spreads,totals`
- `bookmakers=draftkings,fanduel,caesars,betmgm,bet365,betrivers`

## Health check

When the backend is running, go to:

`http://localhost:3000/health`

You should see:

- `ok: true`
- `odds_api_configured: true`

If `odds_api_configured` is false, your `.env` key is missing or not loaded.

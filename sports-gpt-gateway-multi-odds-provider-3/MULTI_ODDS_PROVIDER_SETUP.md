# Multi-Odds-Provider Gateway Setup

This branch supports automatic odds-provider routing while leaving the Supabase bet-log and postmortem code unchanged.

## Default routing

Main odds, scores, and events:

1. SportsGameOdds
2. ParlayAPI
3. The Odds API

The sports catalogue prefers:

1. ParlayAPI
2. The Odds API
3. SportsGameOdds

This avoids returning SportsGameOdds' broad sport IDs where the existing GPT expects sport keys such as `basketball_nba`.

## Render environment variables

Keep the existing Supabase variables:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`

Odds providers:

- `SPORTSGAMEODDS_ENABLED=true`
- `SPORTSGAMEODDS_API_KEY=...`
- `PARLAY_API_ENABLED=true`
- `PARLAY_API_KEY=...`
- `THE_ODDS_API_ENABLED=true`
- `ODDS_API_KEY=...`

Optional:

- `ODDS_PROVIDER_ORDER=sportsGameOdds,parlayApi,theOddsApi`
- `ODDS_SPORTS_PROVIDER_ORDER=parlayApi,theOddsApi,sportsGameOdds`
- `ODDS_REQUEST_TIMEOUT_MS=12000`

Odds-API.io remains in the code but is disabled by default.

## What automatic fallback does

For board odds, scores, and event lists, the gateway tries providers in priority order.

If a provider is disabled, unconfigured, temporarily rate-limited, out of credits (when the provider reports that condition), times out, or returns an upstream error, the gateway tries the next configured provider.

SportsGameOdds returns HTTP 429 when its rate/object limits are exhausted, so the gateway temporarily skips it and moves to the next provider.

ParlayAPI quota headers are saved in runtime provider status. A `credit_limit_exceeded` response temporarily removes it from routing until its reported reset time.

The Odds API quota headers are also saved in runtime status.

## Event IDs

Provider event IDs are not interchangeable.

The gateway remembers which provider issued event IDs and also adds `gateway_event_id` to returned event objects when possible. A gateway event ID looks like:

`providerName:providerEventId`

The event-specific odds endpoint can use that prefixed ID, or you can pass the provider explicitly:

`/v1/odds/basketball_nba/events/EVENT_ID/odds?provider=sportsGameOdds`

It intentionally does not blindly send an event ID to another provider.

## Caching

To reduce free-tier usage:

- Sports catalogue: 6 hours
- Odds boards: 30 seconds
- Scores: 15 seconds
- Event lists: 60 seconds
- Event-specific odds: 20 seconds

The cache is in memory, so it resets when Render restarts.

## Useful test URLs

Replace `YOUR-TEST-SERVICE` with the Render test hostname.

- `/health`
- `/v1/odds/providers/status`
- `/v1/odds/sports`
- `/v1/odds/basketball_nba/odds`
- `/v1/odds/americanfootball_nfl/odds`
- `/v1/odds/basketball_nba/scores`
- `/v1/odds/basketball_nba/events`

Force a provider for debugging:

- `/v1/odds/basketball_nba/odds?provider=sportsGameOdds`
- `/v1/odds/basketball_nba/odds?provider=parlayApi`
- `/v1/odds/basketball_nba/odds?provider=theOddsApi`

## Supabase

`src/storage.js` and `src/routes/logs.js` were not changed by this multi-provider work. Existing bet-log and postmortem tables/actions remain on the same Supabase configuration.

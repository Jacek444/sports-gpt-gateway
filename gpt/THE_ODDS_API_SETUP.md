# The Odds API Setup

This is the simplest version.

## What you are doing

You are connecting your GPT directly to The Odds API.

That lets your GPT pull:

- sports list
- odds
- scores
- events
- single-game odds

You do **not** need a backend for this first version.

## Do not do this

- Do not paste your API key into chat
- Do not save your API key inside a file that you might share

Put your API key only into the GPT Action auth field when the builder asks for it.

## Files to use

- OpenAPI file:
  - `openapi/the-odds-api-gpt.yaml`

## Step-by-step

1. Open the GPT builder
2. Open your GPT
3. Click `Configure`
4. Scroll to `Actions`
5. Click `Create new action`
6. Click `Import from OpenAPI schema`
7. Upload:
   - `openapi/the-odds-api-gpt.yaml`
8. The builder should detect API key auth
9. Paste your The Odds API key into the auth field
10. Save the action

## What to test first

Use prompts like:

- `List the available sports from The Odds API`
- `Get NBA odds in American format from DraftKings, FanDuel, Caesars, BetMGM, bet365, and BetRivers`
- `Get today's NHL scores`
- `Get upcoming NCAA men's basketball events`
- `Get odds for this event id using spreads and totals`

## Best sport keys for you

- NFL:
  - `americanfootball_nfl`
- NCAA Football:
  - `americanfootball_ncaaf`
- NBA:
  - `basketball_nba`
- NCAA Men's Basketball:
  - `basketball_ncaab`
- MLB:
  - `baseball_mlb`
- NHL:
  - `icehockey_nhl`

## Best default bookmaker list for you

Use this often:

`draftkings,fanduel,caesars,betmgm,bet365,betrivers`

That keeps the GPT focused on books you actually care about.

## Best default markets

For normal game betting:

`h2h,spreads,totals`

For props or alt lines:

Use the single-event odds endpoint and request only the market you need.

Examples:

- `player_points`
- `player_rebounds`
- `player_assists`
- `alternate_spreads`
- `alternate_totals`

## Important quota rule

The Odds API charges by market and region.

To avoid burning quota:

- keep `regions=us`
- keep `markets=h2h,spreads,totals` for normal checks
- only call props on one event at a time
- use `bookmakers=` to limit the books returned

## Easiest beginner workflow

1. Ask for events
2. Pick one event id
3. Ask for single-event odds
4. Ask the GPT to compare books and tell you the best number

## If the action import fails

Check:

- you uploaded `openapi/the-odds-api-gpt.yaml`
- the server is `https://api.the-odds-api.com`
- the GPT builder accepted the API key auth

If it still fails, use this as your first test prompt after saving:

`Use the action to list available sports`

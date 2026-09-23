# Parlay-Friendly Bet Log Notes

This template is built so one file can track:

- singles
- parlays
- same-game parlays
- bonus bets
- boosted bets

The current CSV has been populated from your settled DraftKings screenshots.
If a screenshot did not show the placed date or bet ID clearly, the row uses:

- a custom `ticket_id` like `dk_custom_001`
- a blank `date`

Those rows are still usable, but you can backfill the missing fields later if you want cleaner history.

## How it works

Each bet uses a shared `ticket_id`.

For every ticket:

1. Add one `slip` row
2. Add one `leg` row for each leg in that slip

## Example

A 3-leg same-game parlay should have:

- 1 row where `row_type=slip`
- 3 rows where `row_type=leg`

All 4 rows should share the same `ticket_id`.

## Most important columns

- `ticket_id`
  Shared ID for the whole bet slip

- `row_type`
  Either `slip` or `leg`

- `bet_type`
  Use `single`, `parlay`, or `sgp`

- `total_legs`
  Number of legs in the full slip

- `parlay_odds`
  Full-slip odds, mainly for the `slip` row

- `leg_odds`
  Individual leg odds, mainly for `leg` rows

- `same_game_parlay`
  `true` if the leg belongs to an SGP

- `correlated_leg`
  `true` if that leg is correlated with another leg in the same slip

- `payout_usd`
  Usually fill this on the `slip` row after the bet settles

## Best way to use it

For singles:

- still use 2 rows:
  - 1 `slip` row
  - 1 `leg` row

That keeps the format consistent and makes GPT analysis easier.

## Beginner rule

If you are short on time, fill these first:

- `ticket_id`
- `row_type`
- `date`
- `league`
- `sportsbook`
- `bet_type`
- `total_legs`
- `parlay_odds`
- `event`
- `market`
- `selection`
- `line`
- `leg_odds`
- `stake_usd`
- `units`
- `is_bonus_bet`
- `result`
- `reason`

Then fill the rest later.

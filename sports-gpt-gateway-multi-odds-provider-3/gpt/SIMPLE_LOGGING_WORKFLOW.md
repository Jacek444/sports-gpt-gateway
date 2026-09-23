# Simple Logging Workflow

Use this if you want the GPT to improve from your betting history without building a backend yet.

## Your Main Files

- `BET_LOG_TEMPLATE.csv`
  This is your master betting log.

- `PARLAY_LOG_NOTES.md`
  This explains how to log parlays, SGPs, and singles using the shared `ticket_id` format.

- `POSTMORTEM_TEMPLATE.md`
  This is your short review file for lessons learned.

## Easiest Setup

Keep just 2 files updated:

1. `bet_log.csv`
2. `postmortem.md`

You can base them on:

- [BET_LOG_TEMPLATE.csv](/Users/jacekorf/Documents/New%20project/gpt/BET_LOG_TEMPLATE.csv)
- [PARLAY_LOG_NOTES.md](/Users/jacekorf/Documents/New%20project/gpt/PARLAY_LOG_NOTES.md)
- [POSTMORTEM_TEMPLATE.md](/Users/jacekorf/Documents/New%20project/gpt/POSTMORTEM_TEMPLATE.md)

## Simple Routine

### After you place bets

Add each bet to `bet_log.csv` using:

- one `slip` row for the full ticket
- one `leg` row for each leg in that ticket
- the same `ticket_id` across all rows for that ticket

You do not need to fill every column right away.
At minimum, fill:

- ticket_id
- row_type
- date
- league
- sportsbook
- bet_type
- total_legs
- event
- market
- selection
- stake_usd
- units
- is_bonus_bet
- reason

### After the bet settles

Update that same row with:

- result
- payout_usd
- closing_line if known
- postmortem

### After each betting day

Spend 3 to 5 minutes filling out `postmortem.md`.

Focus on:

- what worked
- what was overpriced
- whether a parlay had a weak leg
- whether you broke your own rules
- what to change next time

## When To Re-Upload Into The GPT

You do not need to re-upload after every single bet.

Good schedule:

- light use: once per week
- active use: every 2 to 3 days
- after a big slate or rough session: same day

Best rule:

Re-upload when enough new bets have happened that you want the GPT using the newest information.

## What To Upload

Upload these current versions to the GPT Knowledge section:

1. your latest `bet_log.csv`
2. your latest `postmortem.md`

If the GPT builder does not let you replace the old file cleanly, remove the older version first, then upload the newest one.

## Best File Naming

Use simple names so you do not confuse yourself:

- `bet_log.csv`
- `postmortem.md`

If you want backups, use:

- `bet_log_2026-03-22.csv`
- `postmortem_2026-03-22.md`

But for the GPT Knowledge upload, keep one main current version whenever possible.

## Fastest Weekly Workflow

### Sunday or end of week

1. Update `bet_log.csv`
2. Fill out `postmortem.md`
3. Upload both files into the GPT
4. Ask:

```text
Review my updated betting log and postmortem. What mistakes am I repeating, what bet types are performing best, and what should I change this week?
```

## Fastest Daily Workflow

1. Add settled bets to `bet_log.csv`
2. Write 3 to 6 lines in `postmortem.md`
3. Re-upload only if you want the GPT to use today’s results immediately

## Best Prompts To Use After Uploading

```text
Use my uploaded betting log and postmortem to identify my biggest recurring mistakes.
```

```text
Based on my uploaded history, which markets should I focus on and which should I avoid?
```

```text
Review my betting history and tell me whether my parlays are too correlated or too dependent on overpriced alternate lines.
```

```text
Use my uploaded files to adjust today’s recommendations to fit my actual strengths and weaknesses.
```

## What The GPT Can Learn From Your Log

It can help identify patterns like:

- too many weak parlay legs
- strong singles versus weak SGP legs
- overpriced alternate spreads
- too much juice
- better results with bonus bets than cash
- stronger performance in props than spreads
- poor live-bet discipline

## What It Cannot Do Automatically

Without a backend or action:

- it cannot watch your files on its own
- it cannot auto-refresh when you edit the CSV
- it cannot permanently remember new results unless you upload them again

## Best Beginner Rule

Do not overcomplicate this.

Start with:

- one CSV log
- one postmortem file
- re-upload every few days

That is enough to make the GPT noticeably more useful.

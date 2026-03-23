# ESPN API Notes

Reference source:

- [ESPN hidden API Docs gist](https://gist.github.com/akeaswaran/b48b02f1c94f873c6655e7129910fc3b)

Important:

- This is not an official ESPN developer product page.
- It is a community-maintained reference to ESPN's hidden endpoints.
- Use it as a secondary source and implementation guide, not as the only source of truth.
- Do not point GPT Actions directly at the gist page.
- If you want GPT Actions to use ESPN data, add ESPN endpoint calls inside your own backend and expose them through your own API.

## Relevant ESPN endpoint families for this project

These are the main endpoint patterns documented in the gist for the leagues you care about.

### NBA

- scoreboard:
  - `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard`
- news:
  - `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/news`
- teams:
  - `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams`

### NFL

- scoreboard:
  - `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard`
- news:
  - `https://site.api.espn.com/apis/site/v2/sports/football/nfl/news`
- teams:
  - `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams`

### NCAA Football

- scoreboard:
  - `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard`
- news:
  - `https://site.api.espn.com/apis/site/v2/sports/football/college-football/news`
- rankings:
  - `https://site.api.espn.com/apis/site/v2/sports/football/college-football/rankings`
- summary by game:
  - `https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=:gameId`

### NCAA Men's Basketball

- scoreboard:
  - `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard`
- news:
  - `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/news`
- teams:
  - `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams`

### MLB

- scoreboard:
  - `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard`
- news:
  - `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/news`
- teams:
  - `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams`

### NHL

- scoreboard:
  - `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard`
- news:
  - `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/news`
- teams:
  - `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams`

## Best use in your setup

### Right now

- Upload this file to your GPT Knowledge if you want the GPT to know ESPN endpoint patterns exist.
- Use ESPN mainly for:
  - scoreboard context
  - game summary context
  - team pages
  - rankings
  - news context

### Later with backend

Best practice:

1. Your backend calls ESPN endpoints
2. Your backend normalizes the data
3. Your GPT Action calls your backend

That keeps your GPT stable even if ESPN changes field names or paths.

## Recommendation

Use ESPN as:

- secondary live/context source
- backup scoreboard/news source
- implementation reference for your backend

Do not use ESPN hidden endpoints as the only live data source for betting decisions when stronger official or paid data is available.

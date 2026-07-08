# Football Match Finder

A low-quota API-Football workflow with:

- rolling cron emails of likely 1X2 match-result picks inferred from current odds;
- five-minute cron scans for in-game goal alerts.

The digest and live-alert scans cover the countries and competitions listed in
`config.json`. Countries currently include China, Japan, South-Korea,
Australia, Sweden, Finland, Iceland, Ireland, USA, England, Spain, Germany,
Italy, Netherlands, and France. Competition filters include World Cup, Euro
Championship, UEFA Champions League, UEFA Europa League, and UEFA Europa
Conference League.

## Request budget

Each rolling email uses:

- one fixture request, or two if the six-hour window crosses midnight;
- up to `DIGEST_MAX_ANALYSES` odds requests.

The default is therefore at most 27 API requests per email. There are six
scheduled emails per day, so the normal cap is about 162 API requests per day.
Results with insufficient data are removed before ranking.

Each live-alert scan uses:

- one live fixtures request;
- one statistics request per focused live match inside the configured windows;
- one live-odds request for matches with actionable signals.

## Local setup

Create `.env` from `.env.example`, then provide:

```text
API_FOOTBALL_KEY=your_api_sports_key
RESEND_API_KEY=your_resend_key
ALERT_EMAIL_TO=your@email.com
```

Generate a report without sending email:

```sh
npm run digest:dry
```

This writes:

- `data/digest-YYYY-MM-DD-HHMM.json`
- `data/digest-YYYY-MM-DD-HHMM.html`

Run and email the digest:

```sh
npm run digest
```

Run one in-game alert scan:

```sh
npm run live-alerts
```

## Ranking

The digest model combines:

- current bookmaker 1X2 odds from API-Football;
- normalized implied probabilities with bookmaker margin removed;
- the best available price for the selected outcome;
- the number of bookmakers sampled;
- the market edge over the next most likely outcome.

The digest main signal focuses on:

- `1X2 match result`: likely home win, draw, or away win

Matches without usable 1X2 odds are skipped. BTTS is not used as an email
signal.

The final score is a ranking heuristic, not a guaranteed result or calibrated
probability.

## Render

`render.yaml` defines:

- `football-daily-digest`, a Cron Job that sends at `07:00`, `11:00`,
  `15:00`, `19:00`, `23:00`, and `03:00` Singapore time;
- `football-live-alerts`, a Cron Job that scans every five minutes and emails
  qualifying in-game signals.

When the Blueprint sync creates the cron job, enter:

- `API_FOOTBALL_KEY`
- `RESEND_API_KEY`
- `ALERT_EMAIL_TO`

No web service is required for the cron digest.

## Configuration

- `DIGEST_WINDOW_HOURS=6`: upcoming kickoff window for each email
- `DIGEST_MAX_ANALYSES=25`: hard cap on odds calls per email
- `DIGEST_MAX_PICKS=12`: maximum matches in the email
- `DIGEST_TIMEZONE=Asia/Singapore`: fixture date and displayed kickoff timezone
- `DIGEST_COUNTRIES`: optional comma-separated override for the countries in `config.json`
- `DIGEST_LEAGUES`: optional comma-separated override for the competitions in `config.json`
- `DIGEST_CONCURRENCY=4`: simultaneous odds requests
- `ALERT_MIN_LEVEL=watch`: minimum in-game signal level to email
- `ALERT_COOLDOWN_MINUTES=90`: Resend idempotency bucket for duplicate live alerts
- `STATISTICS_REFRESH_SECONDS=120`: live statistics cache setting used within one scan
- `UNAVAILABLE_RETRY_SECONDS=900`: retry setting for matches without statistics
- `ODDS_REFRESH_SECONDS=300`: live odds refresh setting used within one scan

## Tests

```sh
npm test
```

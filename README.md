# Football Match Finder

A low-quota football betting workflow with:

- rolling cron emails of likely 1X2 and Asian Handicap picks inferred from current odds.

The digest scans cover the countries and competitions listed in `config.json`.
Countries currently include China, Japan, South-Korea, Australia, Sweden,
Finland, Iceland, Ireland, USA, England, Spain, Germany, Italy, Netherlands,
France, Scotland, Mexico, and Norway. Competition filters include World Cup,
Euro Championship, UEFA Champions League, UEFA Europa League, and UEFA Europa
Conference League, Allsvenskan, Eliteserien, Liga Profesional Argentina,
Chile Primera División, and AFF Championship.

## Request budget

Each rolling email uses:

- one fixture request, or two if the six-hour window crosses midnight;
- up to `DIGEST_MAX_ANALYSES` odds requests.

The default is therefore at most 27 API requests per email. There are six
scheduled emails per day, so the normal cap is about 162 API requests per day.
Results with insufficient data are removed before ranking.

When `SPORTMONKS_MODEL_SIGNALS_ENABLED=true`, each analysed fixture can also
make optional SportsMonks prediction/value-bet requests. If your subscription
does not include those endpoints, the digest logs a warning and continues with
odds plus local calibration.

## Local setup

Create `.env` from `.env.example`, then provide:

```text
FOOTBALL_PROVIDER=sportmonks
SPORTMONKS_API_TOKEN=your_sportmonks_token
SPORTMONKS_AUTH_MODE=query
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

Run one manual in-game scan. Live alert emails are disabled by default unless
`LIVE_ALERTS_ENABLED=true` is set:

```sh
npm run live-alerts
```

## Ranking

The digest model combines:

- current bookmaker 1X2 odds from SportsMonks;
- current bookmaker Asian Handicap odds from SportsMonks;
- SportsMonks value-bet and probability signals when available;
- normalized implied probabilities with bookmaker margin removed;
- the best available price for the selected outcome;
- the number of bookmakers sampled;
- the market edge over the next most likely outcome;
- local historical calibration once enough settled digest picks have been collected.

An odds-agent filter then rejects weak picks before email delivery. By default
it requires enough bookmaker coverage, a meaningful edge over the next outcome,
reasonable odds, and limited bookmaker disagreement.

The digest main signal focuses on:

- `1X2 match result`: likely home win, draw, or away win
- `Asian Handicap`: likely side against the strongest available handicap line

Matches without usable 1X2 or Asian Handicap odds are skipped. BTTS is not used
as an email signal.

The final score is a ranking heuristic, not a guaranteed result or calibrated
probability.

## Calibration

Each digest stores its selected picks in `data/digest-candidates-YYYY-MM-DD.jsonl`.
On the next digest runs, old candidates are checked against finished match
results and written to `data/calibration-results-YYYY-MM-DD.jsonl`.

Until enough local samples exist, picks show `Calibration: collecting local
result history`. After the sample threshold is met, the digest adds league or
market calibration to the pick explanation and adjusts ranking using historical
ROI. This changes the workflow from "most likely outcome" toward "is this price
historically worth taking?"

## Render

`render.yaml` defines:

- `football-daily-digest`, a Cron Job that sends at `07:00`, `11:00`,
  `15:00`, `19:00`, `23:00`, and `03:00` Singapore time.

When the Blueprint sync creates the cron job, enter:

- `SPORTMONKS_API_TOKEN`
- `RESEND_API_KEY`
- `ALERT_EMAIL_TO`

Use the raw SportsMonks API token from your SportsMonks dashboard. Do not use
your login password, and do not add quotes or extra spaces around the token.

No web service is required for the cron digest.

## Configuration

- `DIGEST_WINDOW_HOURS=6`: upcoming kickoff window for each email
- `DIGEST_MAX_ANALYSES=25`: hard cap on odds calls per email
- `DIGEST_MAX_PICKS=12`: maximum matches in the email
- `DIGEST_TIMEZONE=Asia/Singapore`: fixture date and displayed kickoff timezone
- `FOOTBALL_PROVIDER=sportmonks`: digest data provider; set `api-football` only to use the old API-Football fallback
- `SPORTMONKS_API_TOKEN`: SportsMonks API token used by the digest
- `SPORTMONKS_AUTH_MODE=query`: send the token as `api_token`; set `bearer` only if SportsMonks support tells you to use bearer auth
- `SPORTMONKS_MODEL_SIGNALS_ENABLED=true`: add SportsMonks value-bet and probability confirmation when available
- `CALIBRATION_MINIMUM_SAMPLES=12`: settled local picks required before calibration affects ranking
- `DIGEST_COUNTRIES`: optional comma-separated override for the countries in `config.json`
- `DIGEST_LEAGUES`: optional comma-separated override for the competitions in `config.json`; use `Country:League` for generic names such as `Chile:Primera División`
- `DIGEST_CONCURRENCY=4`: simultaneous odds requests
- `ODDS_AGENT_MINIMUM_BOOKMAKERS=3`: minimum 1X2 bookmakers required
- `ODDS_AGENT_MINIMUM_TOP_PROBABILITY=0.45`: minimum normalized top outcome probability
- `ODDS_AGENT_MINIMUM_EDGE=0.08`: minimum gap over the second outcome
- `ODDS_AGENT_MINIMUM_ODD=1.5`: minimum selected outcome price
- `ODDS_AGENT_MAXIMUM_ODD=3.5`: maximum selected outcome price
- `ODDS_AGENT_MAXIMUM_PRICE_SPREAD=0.35`: maximum bookmaker price disagreement

## Tests

```sh
npm test
```

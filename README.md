# Football Match Finder

A low-quota API-Football workflow with:

- rolling emails of likely over 2.5 and likely under 2.5 matches;
- a protected frontend that generates a list for the next three hours on demand.

Both modes cover many countries by distributing the analysis budget across
countries instead of using it entirely on the first leagues returned by the API.

## Request budget

Each rolling email uses:

- one fixture request, or two if the six-hour window crosses midnight;
- up to `DIGEST_MAX_ANALYSES` prediction requests.

The default is therefore at most 27 API requests per email. There are six
scheduled emails per day, so the normal cap is about 162 API requests per day.
Fixtures are selected round-robin across countries for broad coverage. Results
with insufficient data are removed before ranking.

The frontend uses no API-Football requests while idle. Each button click uses:

- one fixture request, or two if the three-hour window crosses midnight;
- up to `SHORTLIST_MAX_ANALYSES` prediction requests.

The default is at most 17 requests per generated list. The result is cached and
the button is locked for 15 minutes.

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

Open the frontend:

```sh
npm start
```

Then visit `http://localhost:3000`. Click **Generate new list** when you want to
spend the request budget.

## Ranking

The model combines:

- home and away scoring averages;
- home and away concession averages;
- API-Football prediction advice and over/under view;
- prediction comparison coverage;
- an expected-goals total converted into an over 2.5 probability.

The final score is a ranking heuristic, not a guaranteed result or calibrated
probability.

## Render

`render.yaml` defines:

- `football-daily-digest`, a Cron Job that sends at `07:00`, `11:00`,
  `15:00`, `19:00`, `23:00`, and `03:00` Singapore time;
- `football-match-finder`, a web service for the on-demand three-hour list.

When the Blueprint sync creates the services, enter:

- `API_FOOTBALL_KEY`
- `RESEND_API_KEY`
- `ALERT_EMAIL_TO`
- `DASHBOARD_USERNAME`
- `DASHBOARD_PASSWORD`

The Resend variables are needed only by the cron job. The dashboard username
and password protect the frontend. Render web services and cron jobs are billed
separately according to their selected plans.

## Configuration

- `DIGEST_WINDOW_HOURS=6`: upcoming kickoff window for each email
- `DIGEST_MAX_ANALYSES=25`: hard cap on prediction calls per email
- `DIGEST_MAX_PICKS=12`: maximum matches in the email
- `DIGEST_TIMEZONE=Asia/Singapore`: fixture date and displayed kickoff timezone
- `DIGEST_CONCURRENCY=4`: simultaneous prediction requests
- `SHORTLIST_WINDOW_HOURS=3`: upcoming kickoff window, clamped to 2-3 hours
- `SHORTLIST_MAX_ANALYSES=15`: prediction-call cap per button click
- `SHORTLIST_MAX_PICKS=10`: maximum cards shown on the frontend
- `SHORTLIST_COOLDOWN_MINUTES=15`: minimum time between scans

## Tests

```sh
npm test
```

# Football Daily Digest

A low-quota API-Football workflow that emails a daily list of likely over 2.5
and likely under 2.5 matches.

Unlike the original live monitor, this command runs once and exits. It covers
many countries by distributing its analysis budget across countries instead of
using it entirely on the first leagues returned by the API.

## Request budget

Each run uses:

- one request for all fixtures on the selected date;
- up to `DIGEST_MAX_ANALYSES` prediction requests.

The default is therefore at most 41 API requests per day. Fixtures are selected
round-robin across countries for broad coverage. Results with insufficient data
are removed before ranking.

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

- `data/digest-YYYY-MM-DD.json`
- `data/digest-YYYY-MM-DD.html`

Run and email the digest:

```sh
npm run digest
```

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

`render.yaml` defines a Render Cron Job named `football-daily-digest`.
It runs at `23:00 UTC`, which is `07:00` in Singapore.

When the Blueprint sync creates the cron job, enter:

- `API_FOOTBALL_KEY`
- `RESEND_API_KEY`
- `ALERT_EMAIL_TO`

Render cron jobs have a minimum monthly charge of $1. The previous
`live-goals-desk` web service can remain suspended or be deleted after the cron
job is confirmed working.

## Configuration

- `DIGEST_MAX_ANALYSES=40`: hard cap on prediction calls per run
- `DIGEST_MAX_PICKS=12`: maximum matches in the email
- `DIGEST_TIMEZONE=Asia/Singapore`: fixture date and displayed kickoff timezone
- `DIGEST_CONCURRENCY=4`: simultaneous prediction requests

## Tests

```sh
npm test
```

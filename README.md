# Live Goals Desk

A local API-Football monitor for two in-play situations:

- first-half over 0.5 goals while a match is still 0-0;
- full-match total-goals over/under pressure.

It combines live score state, fixture statistics, recent changes between polls,
and available in-play prices. Every signal shows its inputs and is stored as
JSONL so the rules can be calibrated against results instead of trusted blindly.

## Setup

1. Create a local environment file:

   ```sh
   cp .env.example .env
   ```

2. Put the API key from the API-SPORTS dashboard in `.env`:

   ```text
   API_FOOTBALL_KEY=your_key_here
   ```

3. Start the service:

   ```sh
   npm start
   ```

4. Open `http://localhost:3000`.

No npm packages are required. Node.js 20 or newer is sufficient.

## How polling works

The service calls `/fixtures?live=all` every 20 seconds. It only requests
`/fixtures/statistics` and `/odds/live` for matches inside the configured
minute windows. This keeps request use tied to relevant matches.

API-Football does not retain historical in-play odds, so snapshots are written
to `data/signals-YYYY-MM-DD.jsonl`. Keep these files if you want to measure
which leagues, score bands, and thresholds actually perform.

## Configure signals

Edit `config.json` to change:

- monitoring minute windows;
- minimum shots on target, shots, corners, and recent shots;
- the score at which a situation becomes `watch`;
- dashboard timezone.

The score is a transparent pressure heuristic, not a calibrated probability.
Do not interpret a score of 80 as an 80% chance of a goal.

## Responsible use

This tool does not place bets and does not promise profit. Before acting,
account for red cards, injuries, match incentives, line movement, suspended
markets, and limits. Start with paper tracking and set fixed exposure rules.

## Tests

```sh
npm test
```

## Deploy on Render

1. Push this project to a private GitHub repository.
2. In Render, choose **New > Blueprint** and connect the repository.
3. Render reads `render.yaml`. Enter the secret environment variables when
   prompted:

   - `API_FOOTBALL_KEY`: your API-SPORTS key;
   - `PUBLIC_URL`: the final `https://...onrender.com` service URL;
   - `DASHBOARD_USERNAME` and `DASHBOARD_PASSWORD`: credentials for the site;
   - `RESEND_API_KEY`: an API key from Resend;
   - `ALERT_EMAIL_TO`: the address that receives alerts.

The service must stay running continuously for in-play polling. The included
Blueprint uses Render's `starter` web-service plan.

## Email alerts

Email delivery uses the Resend HTTPS API. The default sender,
`onboarding@resend.dev`, can send test messages to the email address associated
with your Resend account. For normal delivery, verify a domain in Resend and
change `ALERT_EMAIL_FROM` to an address on that domain.

By default, `watch` and `strong` signals trigger email. A fixture and signal
level is suppressed for 90 minutes after sending, preventing every poll from
creating another message. Configure this with:

- `ALERT_MIN_LEVEL=strong` to receive only strong signals;
- `ALERT_COOLDOWN_MINUTES=90` to change duplicate suppression;
- comma-separated addresses in `ALERT_EMAIL_TO` for multiple recipients.

Alert memory is held by the running service. A Render restart can allow the
same active match to alert again.

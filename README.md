# Workflow Runner

A Node.js toolkit for scheduled browser checks, configurable selection rules, persistent state, and event notifications.

## Setup

Use Node.js 24, install dependencies with `npm ci`, and install the browser with `npx playwright install --with-deps chrome`.

Keep local configuration in `.env`. Hosted runs use encrypted repository secrets; credentials and runtime state are excluded from source control.

## Operation

The workflow supports recurring cloud scans and an interactive local runner. Durable state prevents repeated actions, and notifications are limited to new or changed matching results. External integrations are configured through environment variables.

Cloud execution and final actions have separate controls. Initialize persistent state and verify a manual scan before enabling final actions. Recovery uses persistent limits and outcome checks.

Dashboard exports are written to the ignored local `public/` directory. The public landing page contains no operational records.

## Verification

Run the offline suite with `node --test tests/*.test.cjs`.

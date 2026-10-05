# Scheduled Workflows

A Node.js toolkit for scheduled browser checks, configurable selection rules, persistent state, and event notifications.

## Setup

Use Node.js 24, install dependencies with `npm ci`, and install the browser with `npx playwright install --with-deps chromium`.

Keep local configuration in `.env`. Hosted runs use encrypted repository secrets; credentials and runtime state are excluded from source control.

## Operation

The workflow supports recurring cloud scans and an interactive local runner. Durable state prevents repeated actions, and notifications are limited to new or changed matching results. External integrations are configured through environment variables.

Cloud execution and final actions have separate controls. Initialize persistent state and verify a manual scan before enabling final actions. An uncertain outcome remains locked for review.

## Verification

Run the dedicated offline suite with `node --test tests/doslagos.test.cjs`.

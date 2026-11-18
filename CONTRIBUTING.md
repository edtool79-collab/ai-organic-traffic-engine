# Contributing

Describe the problem, the expected result and the steps needed to reproduce it. Use the built-in demo site or an authorized test fixture when sharing a reproduction.

Follow the [quickstart](README.md#quickstart) to set up the dashboard. For changes to the run pipeline, execute a short scenario on the built-in demo site and compare the live log, per-step outcomes and final report. For dashboard changes, exercise the affected controls in the browser. Include what you verified in the pull request.

Run `npm test` for redaction checks. With Chromium installed, run `node tests/signup-release.js` to record and replay a local signup twice against a fixture email provider.

Keep configuration examples free of account data. Keep local configuration, proxy lists, provider credentials, reports and browser profiles out of commits. Review `git diff --cached` before pushing and redact personal data from logs or screenshots.

See [the technical specification](docs/SPEC.md) for the source layout and API.

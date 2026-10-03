# Plan — Portfolio Viewer

Design: [docs/superpowers/specs/2026-09-26-portfolio-viewer-design.md](superpowers/specs/2026-09-26-portfolio-viewer-design.md).
Each sub-project has its own implementation plan in `docs/superpowers/plans/`.

- [x] 0. Design approved, repository created
- [x] 1. Core — scaffold, ledger + returns, schema + repositories, auth + access gate, self-host compose (PR #1)
- [x] 2. Market data — provider interface, Yahoo + ECB, worker jobs (symbol search API moves to 3)
- [x] 3a. Input — search, transactions, portfolio page with values, split suggestions, JBP look
- [x] 3b. Input — CSV import/export, settings, member invitations
- [x] 4a. Display — dashboard, charts, returns, benchmarks, allocation, position chart
- [x] 4b. Display — TV mode + pairing
- [x] 4c. Display — "today's holdings over the past years" chart, labelled hypothetical (spec §5); transfers between own portfolios on the dashboard series; stock detail view on the TV (select a card, open its chart)
- [x] 5a. Android — app for phone and TV, CI build, store material, signed release bundle
- [ ] 5b. Android — Play Console internal testing, then production (Jim's account; real use needs the hosted instance)
- [ ] 6. Hosted — portfolio.jbpcapital.de, jbpcapital.de auth, invites, paid provider (blocked: provider decision)
- [x] 7a. Open-source release prepared — source link (AGPL §13), release workflow with GHCR images, README, self-hosting guide, CONTRIBUTING, SECURITY
- [x] 7b. Open-source release published — repository public, v0.1.0 released, images public and tested as a stranger, private vulnerability reporting on
- [ ] 8. Later — family migration (decision pending)

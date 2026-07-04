# MarketMind AI

MarketMind AI is the graduation project monorepo for an AI-assisted marketing platform for Egyptian cafes and restaurants.

Implementation has not started yet. This repository currently contains only:

- planning and requirement documents under `Docs/`
- an empty npm workspace skeleton for future implementation

The current planning pack lives in:

```text
Docs/planning/
```

Sprint 1 is expected to start with:

- real Discovery AI foundation
- NestJS Auth/RBAC foundation

No product features, agent logic, frontend app, backend app, or dependencies are implemented yet.

## Manual testing (Discovery)

A local testing harness for the Prepared Discovery module lives on the
`feature/discovery-test-harness` branch. It adds a one-command startup script
(`./dev-up.sh`), a stop script (`./dev-down.sh`), and a self-contained browser
playground (`apps/web/discovery-playground.html`). See
`Docs/testing/README.md` on that branch for the full guide.

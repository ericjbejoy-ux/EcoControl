# CarbonTwin backend scaffold

A mock-first Fastify + TypeScript backend for independent frontend and ML integration. It implements the requested API contract with deterministic, clearly labeled synthetic data and shared Zod schemas.

## Requirements

- Node.js 20+
- npm 10+ (npm workspaces)
- Docker with the Compose plugin (optional)

## Run locally

```sh
npm install
npm run dev
```

The API is available at `http://localhost:4000/api/v1`. Start with `/health`, `/facilities`, or the complete route list in [docs/api.md](./docs/api.md).

## Test and typecheck

```sh
npm test
npm run typecheck
```

## Run with Docker

```sh
docker compose up --build
```

This starts the standalone API at `http://localhost:4000`; it does not depend on the not-yet-added web or ML services. To stop it, press `Ctrl+C` and optionally run `docker compose down`.

## Project layout

- `apps/api/src/routes/`: REST endpoints grouped by product domain.
- `apps/api/src/services/`: mock domain behavior and response generation.
- `apps/api/src/mock/mockData.ts`: deterministic facility, power, grid carbon, and thermal generators.
- `apps/api/src/ws/`: in-process WebSocket hub shape (no WebSocket listener yet).
- `packages/shared/src/`: Zod request/response contracts and inferred types shared with clients.
- `apps/api/src/tests/`: route and mock-range tests.

All route and schema details are in [docs/api.md](./docs/api.md). The complete product specification is [SRS (2).md](./SRS%20(2).md).

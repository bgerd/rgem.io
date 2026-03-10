# Contributing to RGEM.io

Thanks for your interest in contributing! This document covers how to get started.

## Development Setup

1. **Clone the repo**
   ```bash
   git clone https://github.com/bgerd/rgem.io.git
   cd rgem.io
   ```

2. **Configure an environment**
   ```bash
   cp samconfig.toml.example samconfig.toml
   # Edit samconfig.toml with your AWS-specific values
   ./configure.sh dev
   ```

3. **Install app dependencies**
   ```bash
   cd app
   npm install
   ```

## Running Locally

```bash
cd app
npm run dev       # Dev server at localhost:5173
npm run lint      # ESLint
npm run test      # Vitest unit tests
```

## Code Conventions

See [CLAUDE.md](CLAUDE.md) for detailed conventions. Key points:

- **Backend**: ES modules, async/await, camelCase, Node.js 20
- **Frontend**: Strict TypeScript, functional React components, PascalCase for components/types
- **Hardware**: UPPER_CASE constants, camelCase functions, enum-based state machine
- **Comments**: Use `TODO:`, `NOTE:`, `HACK:`, `FIXME:` markers. Preserve existing annotations.

## Commit Messages

Follow the existing format: `type:scope: description`

Examples:
```
fix:app: correct lint issues
refactor:app: extract standalone functions to src/lib
build:app: install vitest and implement basic tests
```

## Branch Strategy

Three long-lived branches map directly to deployed environments:

| Branch  | Environment | URLs                                          |
|---------|-------------|-----------------------------------------------|
| `main`  | dev         | app-dev.rgem.io, ws-dev.rgem.io               |
| `stage` | stage       | app-stage.rgem.io, ws-stage.rgem.io           |
| `prod`  | prod        | app.rgem.io, ws.rgem.io, rgem.io (landing)    |

`prod` is always a subset of `stage`; `stage` is always a subset of `main`. Changes flow in one direction only: `main → stage → prod`.

### Feature work

```
main ──── feature/my-feature ────► main  (PR)
                                     │
                                  deploys to dev
```

1. Cut a `feature/*` (or `fix/*`, `chore/*`, etc.) branch from `main`
2. Open a PR against `main`
3. Merge when ready; deploy to dev to verify:

   Run `./configure.sh dev && ./infra/scripts/deploy-backend.sh && ./infra/scripts/deploy-app.sh`

### Promotion to stage

```
main ────────────────────────────► stage  (PR)
                                     │
                                  deploys to stage
```

1. Open a PR from `main` into `stage`
2. Merge when dev has been verified
3. Run `./configure.sh stage && ./infra/scripts/deploy-backend.sh && ./infra/scripts/deploy-app.sh`

### Promotion to prod

```
stage ───────────────────────────► prod  (PR)
                                     │
                               deploys to prod
                              (+ landing page)
```

1. Open a PR from `stage` into `prod`
2. Merge when stage has been verified
3. Run `./configure.sh prod && ./infra/scripts/deploy-backend.sh && ./infra/scripts/deploy-app.sh`
4. If landing page changed: `./infra/scripts/deploy-landing.sh`

> **Future:** CI/CD automation is planned for the RGem App and Landing Page deployments. When implemented, a merge to `stage` or `prod` will trigger the relevant deploy scripts automatically.

### Hotfixes

For urgent production fixes — including all Landing Page changes (which have no dev/stage equivalent) — bypass the normal promotion chain:

```
prod ──── hotfix/fix-name ────► prod  (PR)
                                  │
                                  └──► main  (back-merge PR, mandatory)
```

1. Cut a `hotfix/*` branch from `prod` (not `main`)
2. Make the fix; open a PR into `prod`
3. Deploy immediately after merge
4. **Mandatory:** open a back-merge PR from `prod` into `main` to prevent drift — do not skip this step
5. `stage` self-heals on the next normal `main → stage` promotion

> **Rule:** `hotfix/*` is the only permitted path that bypasses `stage`. Keep hotfix scope minimal. If the change is large or non-urgent, route it through the normal chain.

## Pull Requests

1. Cut a branch from `main` (feature work) or `prod` (hotfixes) — see [Branch Strategy](#branch-strategy) above
2. Make your changes, following the code conventions above
3. Ensure `npm run lint` and `npm run test` pass in `app/`
4. Open a PR with a clear description of the change

## Questions?

Open an issue for discussion before starting large changes.

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

3. **Install frontend dependencies**
   ```bash
   cd frontend
   npm install
   ```

## Running Locally

```bash
cd frontend
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
fix:frontend: correct lint issues
refactor:frontend: extract standalone functions to src/lib
build:frontend: install vitest and implement basic tests
```

## Pull Requests

1. Fork the repo and create a feature branch from `main`
2. Make your changes, following the code conventions above
3. Ensure `npm run lint` and `npm run test` pass in `frontend/`
4. Open a PR against `main` with a clear description of the change

## Questions?

Open an issue for discussion before starting large changes.

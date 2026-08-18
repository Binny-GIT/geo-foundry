# Geo Foundry

Governed Node.js 24 ESM monorepo for the Geo Foundry platform.

## Toolchain

- Node.js 24.18.0
- pnpm 11.22.0
- Turborepo 2.10.10
- TypeScript 5.9.3
- Biome 2.5.8

## Workspace Layout

- `apps/` contains deployable applications.
- `packages/` contains published workspace packages.
- `examples/` contains consumer applications.

All workspace packages are ESM-only and use explicit package exports. Internal package links use
the `workspace:*` protocol.

## Commands

```sh
corepack enable
pnpm install --frozen-lockfile
make check-toolchain
pnpm check
```

Use `pnpm format` to apply formatting. `pnpm lint`, `pnpm typecheck`, `pnpm test`,
`pnpm test:integration`, `pnpm test:e2e`, `pnpm build`, and `pnpm dev` are the governed root
entry points. Real integration tasks are never Turbo-cacheable; use `pnpm test:integration:fresh`
when the command receipt must also show an explicit forced execution.

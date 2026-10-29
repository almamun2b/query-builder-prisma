# Changelog

Notable changes to `@almamun2b/prisma-query-builder`. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is semver
over the public surface (`src/index.ts` exports) plus the README behavior
contracts.

## [Unreleased]

### Fixed

- **HIGH — seed `where` no longer replaceable.** `.custom({ where })`
  now AND-es with the seeded `initialArgs.where` and previous custom `where`s
  instead of silently replacing the seed (previously a soft-delete filter
  could be lost). Regression-tested in `test/unit/query-builder.test.ts`.
- **HIGH — `executeWithMeta()` rejects cursor mode.** It now throws
  a descriptive error when `.cursorPaginate()` was configured, instead of
  returning cursor rows with fabricated offset meta and a leaked over-fetch
  row. Use `executeWithCursor()` in cursor mode.
- **HIGH — nested `include` types keep base fields.** The
  projection engine types `.include({ posts: { include: { comments: true } } })`
  as `User & { posts: (Post & { comments: Comment[] })[] }` — matching runtime
  truth instead of dropping the relation's own fields; `| null | undefined`
  optionality preserved. Strict `Expect<Equal>` tests in
  `test/types/projection.type-test.ts`.

### Added

- Claude Code agent tooling: `design-rules-auditor` and `release-gate` agents,
  the project-authored `add-dialect` skill, and a shared permission allowlist.
- Repo hygiene: CONTRIBUTING.md, SECURITY.md, PR/issue templates, CODEOWNERS,
  `package.json` `bugs`/`homepage`.

### Removed

- `PLAN.md` (its surviving rules are single-sourced in ARCHITECTURE.md and
  AGENTS.md). Defect tracking moved out of the published docs; open limitations
  are documented in the README (`Known limitations`).
- Prisma-specific agent tooling: the 10 installed `prisma-*` skills and
  `.mcp.json` (Prisma docs MCP, Context7). This package imports nothing from
  Prisma, so tooling for using Prisma added noise without value.

## [0.1.0] — 2026-10-29

Initial release: a fluent, zero-coupling query builder over Prisma's structural
`findMany` + `count` delegate call shape — search/filter/range/sort, offset and
cursor pagination, a structural compile-time projection engine (`select`/
`include` narrowing without Prisma types), and a dialect capability registry
(`mode: 'insensitive'` gating), dual ESM+CJS.

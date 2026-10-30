# Contributing

Short version: **`npm run verify` green = the bar.** It runs lint → typecheck →
test → build, the same gate CI runs on Node 18/20/24. A change is not done until
it is green, with **zero Prisma installed and no database running** — that is
the standing proof of the zero-coupling design, not an accident.

## Before you change code

Read [AGENTS.md](./AGENTS.md) (rules + review checklist) and
[ARCHITECTURE.md](./ARCHITECTURE.md) (layer boundaries). The short form:

1. **Zero Prisma coupling** — no runtime or type imports from `@prisma/client`,
   `prisma`, or generated code; no `dependencies`/`peerDependencies`. All types
   are extracted structurally from the delegate.
2. **Dialects are data, not branches** — per-DB behavior lives in
   `src/dialects/capabilities.ts`; database names may appear only in
   `src/dialects/`. Recipe: `.claude/skills/add-dialect/SKILL.md`.
3. **Types never lie** — projection changes must widen, never narrow below
   runtime truth, and need strict `Expect<Equal<A, B>>` assertions in
   `test/types/*.type-test.ts` (verified by `npm run typecheck`, not vitest).
4. **Limitations are documented, not hidden** — open gaps live in the README
   (`Known limitations`); do not extend one's code path, and when you fix one,
   update the README and add a regression test in the same change.

## Where things live

- `src/core/` — the stateful fluent builder + pure `conditions.ts`/`pagination.ts`.
- `src/types/` — the structural contracts and the compile-time projection engine.
- `src/dialects/` — capability registry (pure data + resolution order).
- `test/unit/` — runtime behavior against recorded fake delegates;
  `test/types/` — compile-time projection shapes. Fixtures in
  `test/helpers/fake-delegate.ts` are hand-written and Prisma-free on purpose.
- `dist/` is build output, never source — don't edit or import from it.

Docs are single-sourced: design in ARCHITECTURE.md, working rules in AGENTS.md,
behavior contracts and known limitations in the README. Behavior changes update
the README "Behavior contracts" section in the same change.

## Working with AI agents (Claude Code)

- `.claude/agents/design-rules-auditor` — run after non-trivial `src/`/`test/`
  changes; enforces the checklist above.
- `.claude/agents/release-gate` — full pre-publish gate before version bumps.
- `.claude/skills/add-dialect` — project-authored recipe for adding a database
  dialect without touching `src/core/`.
- No Prisma-specific skills or MCP servers: the package imports nothing from
  Prisma, so there is nothing for such tooling to do here.

## Commit messages

Commits follow [Conventional Commits](https://www.conventionalcommits.org/) —
they are what semantic-release parses on `main` to pick the next version, and
the format is enforced by commitlint:

```text
type(scope)?: subject        e.g. fix: strip undefined where keys
feat!: / BREAKING CHANGE:    for breaking changes
```

| Type                                  | Effect on release (push to `main`) |
| ------------------------------------- | ---------------------------------- |
| `fix:`, `perf:`, `revert:`            | patch                              |
| `feat:`                               | minor                              |
| `feat!:` or `BREAKING CHANGE:` footer | major                              |
| `docs:`, `chore:`, `ci:`, `test:`, …  | no release                         |

Enforcement is two-layered: a husky `commit-msg` hook (installed automatically
by the `prepare` script) rejects bad messages at commit time, and a CI job
re-checks every PR and push to `main` — a `--no-verify` bypass is caught at CI,
not by npm. Scope is free-form (`feat(dialects): …`); the type is what matters.

## Releases

`prepublishOnly` runs the verify gate; the `release-gate` agent additionally
checks the tarball file list, coupling sweep, scope drift, and the
known-limitations review. Semver applies to the `src/index.ts` exports plus the
README behavior contracts.

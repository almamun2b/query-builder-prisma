# PLAN — `@mamun/prisma-query-builder`

> A zero-coupling, fluent, fully type-safe query builder for Prisma that works with
> **every Prisma version (5, 6, 7, 8, and future ones)** and **every database Prisma supports**.
>
> Status: v0 — base project scaffold. Package name scope `@mamun/` is a placeholder;
> change it in `package.json` + `PLAN.md` before first publish.

---

## 1. Product definition

**One sentence.** An npm package that wraps any Prisma model delegate with a fluent,
chainable query API (search, filter, range, sort, offset & cursor pagination,
projection) whose TypeScript types are derived from *whatever delegate you give it* —
never from Prisma's own packages — so it cannot break when Prisma changes.

**Primary users.** TypeScript/Node backend developers (Express/Nest/Fastify/Hono …)
who build list endpoints and are tired of hand-assembling `where`/`orderBy`/`skip`
boilerplate for every model.

**Why it can exist.** Prisma's *stable public contract* has been the model-delegate
call shape — `model.findMany({ where, orderBy, skip, take, select, include, cursor })`
— since v2. Our package speaks *only* that contract, structurally. Everything else
(engine, generator, type utilities, import paths) has churned across majors and is
exactly what we refuse to touch.

---

## 2. Design rules (the future-proofing contract)

These four rules are the whole strategy. Every PR must be checked against them.

### Rule 1 — Zero Prisma coupling, ever
- **No runtime dependency** on `@prisma/client`, `prisma`, or engine internals.
- **No type imports** from `generated/*`, `@prisma/client`, or `Prisma.*` utilities.
- `peerDependencies`: **none.** (Nothing to break, nothing to install.)
- Consequence: an app on Prisma 5, 7, 9-beta, or an unreleased canary all work
  identically, because we only ever see *their* generated delegate objects.

### Rule 2 — Everything is structural
The only thing we require of a "model" is the shape it already has:

```ts
interface PrismaModelDelegate {
  findMany: (...args: never[]) => unknown;
  count: (...args: never[]) => unknown;
}
```

All argument types (`where`, `orderBy`, `select`, `include` keys), and all result
types, are *extracted* from the delegate via `Parameters<>` / `ReturnType<>`:

```ts
type FindManyArgsOf<D> = NonNullable<Parameters<D['findMany']>[0]>;
type RowOf<D>          = Awaited<ReturnType<D['findMany']>>;   // rows array
```

If Prisma keeps the call shape (their public, documented, backward-compatible API),
we keep working — types included — with **no changes to this package**.

### Rule 3 — Types degrade gracefully, never lie
Perfect projection narrowing (`.select()` narrowing the output type) normally needs
`Prisma.Result` — a Prisma-internal utility that doesn't exist pre-4.16 and moves in
v7/v8. We therefore own the logic with a **structural projection engine**:

- Extract the base row element from `RowOf<D>`.
- Walk the user's `select`/`include` object recursively (`true` → keep field,
  nested `select` → recurse into the relation's element type, which is already
  encoded in the base row type).
- Result: ~Prisma-exact narrowing, implemented in ~100 lines of pure TypeScript
  conditional types, valid on **every** version.
- Known gaps (include-with-filter nullability nuances, `_count` precision) degrade
  to the *wider* correct type — never a wrong type. Documented in README.

Escape hatches that stay version-proof:
- `buildArgs()` returns args typed with the accumulated `TArgs`, so the passthrough
  `prisma.user.findMany(qb.buildArgs())` gets **100% Prisma-native inference** on
  every version (Prisma's own overloads resolve the narrowing — zero config).
- `executeAs<T>()` for manual precision when wanted.

### Rule 4 — Dialects are a capability registry, not if-branches
Prisma-supported DBs disagree on operators (e.g. `mode: 'insensitive'` exists only on
PostgreSQL / CockroachDB / MongoDB; passing it to MySQL / SQLite / SQL Server **throws**).
Future Prisma majors will add more databases. So:

- A `DialectCapabilities` record describes what a dialect allows.
- `search()`, and later full-text/JSON helpers, consult the registry.
- New/future DB = one `registerDialect('newdb', {...})` call by us or by users.
  **No core code changes** — that's what "supports all future Prisma DBs" means here.

| Capability            | postgres | cockroach | mysql | mariadb | sqlite | sqlserver | mongodb |
| --------------------- | -------- | --------- | ----- | ------- | ------ | --------- | ------- |
| `mode: 'insensitive'` | ✅       | ✅        | ❌    | ❌      | ❌     | ❌        | ✅      |
| case-insensitive `contains` (collation) | ❌ | ❌ | ✅ | ✅ | ❌ (ASCII) | ✅ | n/a |
| full-text search      | v1.x     | —         | v2    | v2      | —      | —         | v2      |
| JSON path filtering   | ✅       | ✅        | ✅    | ✅      | ✅     | ✅        | ✅      |

Dialect resolution order (fails soft to `'universal'` = no dialect-specific args):
1. Per-builder override: `new QueryBuilder(prisma.user, { dialect: 'mysql' })`
2. Global config: `configureQueryBuilder({ dialect: 'postgres' })`
3. Auto-detect (best-effort, guarded — may improve across releases)
4. `'universal'` default (always valid everywhere)

---

## 3. Architecture

```
src/
├── index.ts                  # public API: QueryBuilder, config, dialect utils
├── core/
│   ├── query-builder.ts      # fluent builder (dialect-agnostic logic only)
│   ├── conditions.ts         # AND/OR assembly, undefined-stripping, dot-paths
│   └── pagination.ts         # offset + cursor (seek) math, meta computation
├── dialects/
│   ├── registry.ts           # capability registry + registerDialect()
│   ├── capabilities.ts       # built-in capability sets per DB
│   └── detect.ts             # best-effort auto-detection (fail → 'universal')
├── types/
│   ├── delegate.ts           # structural delegate contracts + extraction helpers
│   ├── projection.ts         # type-level select/include result engine (Rule 3)
│   └── public.ts             # user-facing option/meta types
└── adapters/                 # v2 (monorepo-ready): express/fastify/nest param adapters
```

**Output targets:** dual ESM + CJS, `.d.ts` per module, `exports` map.
**Runtime deps:** none. **Dev deps:** TypeScript, tsup, vitest, eslint, prettier,
`expect-type` (type tests), dockerized DBs for integration (CI only).

---

## 4. Public API (v1)

Same fluent surface the prototype already proved, now version-proof:

```ts
const { meta, data } = await new QueryBuilder(prisma.user)
  .search({ searchText: q, fields: ['email', 'username'] }) // dialect-aware
  .filter({ role, status })                                  // undefined-safe
  .range({ createdAt: { from, to }, 'avatar.size': { from: min } })
  .where({ OR: [...] })                                      // raw escape hatch
  .sortBy({ sortBy: 'createdAt', sortOrder: 'desc' })
  .paginate({ page: 1, limit: 20 })                          // offset style
  .cursorPaginate({ cursor, direction: 'forward', cursorField: 'id' })
  .select({ id: true, email: true })                         // structurally narrowed
  .include({ posts: { select: { title: true } } })
  .custom({ distinct: ['email'] })
  .executeWithMeta();
```

v1 additions over the prototype:
- `orderBy` arrays / multi-key sort, safe `skip/take` clamping.
- `.first()` (findMany+limit 1) and `.firstOrThrow()` semantics documented.
- `executeWithMeta()` gains optional `includeTotal: false` fast path (skips COUNT).
- All option objects accept a `dialect` override.

Explicit non-goals for v1: SQL generation (Prisma does that), aggregates/groupBy
(v2), transactions (out of scope), query-param adapters (v2), zod integration (v2).

---

## 5. Compatibility strategy

| Dimension     | Policy                                                                 |
| ------------- | ---------------------------------------------------------------------- |
| Prisma 5–8    | Guaranteed + integration-tested (matrix in §6).                        |
| Prisma < 5    | Runtime-compatible by design (structural); best-effort, untested.      |
| Future majors | Expected to work with **zero changes** (Rules 1–4). A nightly canary CI job runs the suite against `prisma@dev`/RC to prove it and catch breakage early. |
| TypeScript    | Support TS ≥ 5.0 (emitted d.ts avoids newer-only syntax; package itself uses `satisfies`, TS 4.9+). |
| Node          | ≥ 18 engines field; no Node-only APIs in core.                          |
| Frameworks    | None. Adapters live in v2 scope, optional imports.                     |

The published contract is the **call-shape compatibility**, stated in the README:
"Works with any Prisma whose delegates accept the standard findMany args."

---

## 6. Testing strategy (how we *prove* "all versions, all DBs")

1. **Unit tests (no Prisma anywhere).** Hand-written fake delegates prove the core
   works with *any* conforming object — this doubles as the decoupling proof.
   Coverage: condition assembly, undefined-stripping, dot-paths, pagination math,
   cursor forward/backward logic, dialect gating.
2. **Type tests** (`expect-type`): projection narrowing for flat select, nested
   select, include, include+select mutual exclusion, relation arrays, nullable
   relations, degradation cases.
3. **Integration matrix (CI).** Generated test apps pinned to
   `prisma@5 / 6 / 7 / 8(-rc)` × `postgres, mysql, sqlite, mongodb` (GitHub
   Actions services), running the same behavioral suite against real DBs —
   including asserting `.search()` never emits `mode` on non-capable dialects.
4. **Canary job:** nightly suite against `prisma@latest` + `@dev` so a future
   major's breaking change is detected before users hit it.
5. **Type-level smoke in matrix:** each matrix cell compiles a fixed consumer file
   (tsc `--noEmit`) against that Prisma version's generated client.

---

## 7. Milestones

| # | Milestone | Contents | Exit criteria |
| - | --------- | -------- | ------------- |
| M0 ✅ | Base project | Repo scaffold, tsconfig strict, tsup dual build, vitest, eslint+prettier, CI skeleton, PLAN.md, ported prototype into `src/` (structural types + dialect registry wired) | `npm run build` + `npm test` green with zero Prisma deps installed |
| M1 | Core solid | Projection type engine + type tests, pagination module, `first()`, multi-orderBy, clamping, 90%+ unit coverage | All unit + type tests green |
| M2 | Dialects complete | Full capability sets, auto-detect, `registerDialect` API + docs, per-method dialect gating | Unit tests × 7 dialects; docs published in README |
| M3 | Version/DB matrix | Test-app generator, dockerized CI matrix, canary job | Matrix green on 5/6/7/8-rc × pg/mysql/sqlite/mongo |
| M4 | Publish-ready | README/website-lite docs, examples (express, nest, fastify), semver+release workflow, npm trust/provenance, name finalized | `npm publish --dry-run` clean; docs review done |
| M5+ | v2 track | Monorepo: `@…/query-param-adapters` (express/fastify/nest), zod schema generator, aggregates/groupBy, plugin API | Separate plan per feature |

---

## 8. Risks & mitigations

| Risk | Impact | Mitigation |
| ---- | ------ | ---------- |
| Prisma changes the delegate call shape (the one thing we rely on) | High | It's Prisma's public, stable, heavily-documented API; canary CI catches drift months early; our surface is 2 methods — trivial to adapt in one patch release. |
| Projection engine mismatches Prisma's exact output types (nullability, `_count`) | Medium | Degradation rule = wider-but-correct types; passthrough `findMany(qb.buildArgs())` offers exact native inference; gaps documented per release. |
| Auto-detect misdetects dialect → invalid arg sent | Medium | Detection is opt-in-improvable; default `'universal'` is always valid; per-call override wins; integration tests assert no `mode` on incapable DBs. |
| npm name/squatting | Low | Scoped name from day one; reserve unscoped mirror at M4 if desired. |
| Type-level complexity slows d.ts compiles for big schemas | Medium | Keep projection engine shallow-recursive (depth-bounded); benchmark with a 50-model schema in M1. |

---

## 9. Immediate next steps (post-scaffold)

1. M1: implement `types/projection.ts` + `core/pagination.ts` with type tests.
2. M2: fill capability sets + detection heuristics; wire `.search()` gating fully.
3. Open the repo on GitHub, enable the CI matrix, set the final npm scope.

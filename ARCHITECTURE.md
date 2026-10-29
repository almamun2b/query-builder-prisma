# ARCHITECTURE

> How this package is structured, why each boundary exists, and where new work is
> allowed to go. Task-level rules live in [AGENTS.md](./AGENTS.md); known
> limitations are documented in the README.

## The load-bearing idea

Prisma has churned almost every surface it has — import paths (v7), the type
utilities (v8), the engine. The one thing it has kept stable and documented since v2
is the **model-delegate call shape**:

```
model.findMany({ where, orderBy, skip, take, select, include, cursor, distinct })
model.count({ where })
```

This package speaks *only* that shape — at runtime and at the type level — and
imports nothing else from Prisma. Every architectural rule below exists to protect
that decision. A change that weakens it is wrong regardless of how reasonable it
looks locally.

## System view

```
              your application
    new QueryBuilder(prisma.user, { dialect? })
                  │  any delegate object, any Prisma version
                  ▼
    ┌─────────────────────────────────────┐
    │  core/query-builder.ts              │ ◀── fluent chain mutates state
    │  the ONLY stateful module           │
    └───────────┬──────────────┬──────────┘
       folds    │              │  "what is allowed here?"
       state    ▼              ▼
    ┌────────────────────┐  ┌────────────────────────┐
    │ core/conditions.ts │  │ dialects/registry.ts   │
    │ core/pagination.ts │  │  capabilities per DB   │
    │  (pure functions)  │  │  (data, not branches)  │
    └─────────┬──────────┘  └────────────────────────┘
              │  delegate.findMany({...}) / delegate.count({ where })
              ▼
    any object with the delegate call shape — Prisma 5/6/7/8, future majors,
    or a hand-written fake (which is how the test suite proves decoupling)
```

Type inference runs entirely at compile time and never touches Prisma:

```
   delegate type D
     │  Parameters<> / ReturnType<>          (types/delegate.ts)
     ▼
   WhereOf<D>, SelectOf<D>, IncludeOf<D>, RowElementOf<D> …
     │  walk the user's select/include spec (types/projection.ts)
     ▼
   result type of execute() — narrowed like Prisma, without Prisma
```

## Layers and dependency direction

| Layer    | Files            | May import                                            | Must never import   |
| -------- | ---------------- | ----------------------------------------------------- | ------------------- |
| contract | `src/types/*`    | each other                                            | `src/core`, `src/dialects`, Prisma |
| dialects | `src/dialects/*` | `src/dialects/capabilities`                           | `src/core`, Prisma  |
| core     | `src/core/*`     | contracts, `dialects/registry`, sibling core modules  | Prisma              |
| entry    | `src/index.ts`   | everything                                            | —                   |

The entry is single (`src/index.ts`) because tsup builds dual ESM+CJS from it;
anything not re-exported there does not exist for consumers.

### Module map

| Module                   | Role                                                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `types/delegate.ts`      | The only Prisma knowledge: the structural `findMany` + `count` contract and the `Parameters<>`/`ReturnType<>` extractors. |
| `types/projection.ts`    | The compile-time projection engine (`ApplySelect`/`ApplyInclude`) that narrows results like Prisma's own overloads. |
| `types/public.ts`        | User-facing option/meta types (`FilterInput`, `PaginationMeta`, …), themselves derived from the delegate.    |
| `core/conditions.ts`     | Pure condition assembly: `stripUndefined`, dot-path expansion, `combineAnd`.                                 |
| `core/pagination.ts`     | Pure offset/seek math: clamping, `toOffsetArgs`, `toCursorArgs`, `buildCursorPage`.                          |
| `core/query-builder.ts`  | The fluent facade. Owns all mutable state; the only module that calls the delegate.                          |
| `dialects/capabilities.ts` | Capability sets per database (pure data).                                                                 |
| `dialects/registry.ts`   | `registerDialect`, `configureQueryBuilder`, dialect resolution order.                                        |
| `dialects/detect.ts`     | Opt-in auto-detect hook; v0 always returns `undefined` → falls through to `'universal'`.                     |

## The four invariants

1. **Zero Prisma coupling.** No runtime or type imports from `@prisma/client`,
   `prisma`, or generated code; no `dependencies`, no `peerDependencies`.
   Verified by the fake-delegate suite compiling and passing with no Prisma
   install at all.
2. **Everything is structural.** The only required shape is `findMany` + `count`.
   All argument/result types are extracted from the delegate, never hand-written.
   Lives in `types/delegate.ts`.
3. **Types degrade gracefully, never lie.** When the projection engine cannot
   mirror Prisma exactly, it widens — a narrower-than-runtime type is a
   HIGH-severity defect. Verified by the strict
   `Expect<Equal<A, B>>` assertions in `test/types/*.type-test.ts`.
4. **Dialects are a capability registry, not if-branches.** Per-DB behavior is a
   record consulted at runtime. Database names may appear only in
   `src/dialects/` — an occurrence in `src/core/` or `src/types/` is a
   review-blocking violation. Lives in `dialects/capabilities.ts` +
   `dialects/registry.ts`.

## Runtime data flow (one query)

1. Chain methods mutate private fields (`andConditions`, `orderBy`, `selectArg`,
   pagination state, …). No I/O happens yet.
2. `buildArgs()` folds state into `findMany` args with a fixed precedence:
   **explicit methods beat `custom()` args** (`.select()` over
   `custom({ select })`, `.paginate()`/`.cursorPaginate()` over
   `custom({ take })`), while conditions from every `where` source are AND-ed
   (methods, the `initialArgs` seed, `.custom({ where })`).
3. An execute path runs the delegate call(s): `execute`, `first`/`firstOrThrow`,
   `count`, `executeWithMeta` (offset; `count` + `findMany` in parallel),
   `executeWithCursor` (over-fetches one row to detect the next page; slices and
   reverses in `buildCursorPage` so output is always in configured sort order).

Cursor mode wins over offset mode when both are configured.

## State and concurrency contract

- The builder accumulates state per instance: **one builder per query;
  instances are cheap**. Sharing an instance across concurrent requests mixes
  conditions — preserve this contract in every framework recipe.
- Global dialect config (`configureQueryBuilder`) lives in module scope, so a
  bundler loading this package as both ESM and CJS can create two config
  instances (dual-package hazard). The reliable path is the per-builder
  `dialect` option. Never add more module-scope mutable state.

## The type engine in one page

- `RowElementOf<D>` extracts one row from `Awaited<ReturnType<D['findMany']>>`.
- `ApplySelect<Row, S>` keeps the truthy keys of `S` ∩ `keyof Row`, recursing
  through `ProjectField` into relation element types: arrays map over their
  element, `| null | undefined` optionality is preserved exactly.
- `ApplyInclude<Row, I>` intersects the base row with the projected relations.
- `ApplyProjection<Row, TArgs>` picks select vs include vs identity from the
  accumulated args type `TArgs`, which `.select()`/`.include()` thread through
  the builder's return type.
- Escape hatch: `buildArgs()` returns args typed with the accumulated `TArgs`,
  so the passthrough `prisma.user.findMany(qb.buildArgs())` gets 100%
  Prisma-native inference on every version.
- Known precision gaps (`_count`) must degrade *wider*, never wrong,
  and stay documented in the README (`Known limitations`).

## Dialect system

Resolution order (first hit wins; fails soft):

1. per-builder — `new QueryBuilder(delegate, { dialect: 'mysql' })`
2. global — `configureQueryBuilder({ dialect })`
3. registered auto-detector — `setDialectDetector(fn)`
4. `'universal'` — emits only arguments valid on every Prisma-supported database.

Adding a database is one entry in `DIALECT_CAPABILITIES` (or one
`registerDialect()` call); adding per-DB behavior is one new capability flag plus
entries. Neither ever touches `src/core/`. Step-by-step:
`.claude/skills/add-dialect/SKILL.md`.

## Testing architecture (two tracks)

| Track              | Runner                                   | What belongs there                                                                 |
| ------------------ | ---------------------------------------- | ---------------------------------------------------------------------------------- |
| runtime unit       | `vitest` (`test/**/*.test.ts`)           | pure math (`pagination.test.ts`), condition assembly (`conditions.test.ts`), args actually sent (recorded fake delegates), dialect gating |
| compile-time types | `npm run typecheck` (`test/types/*.type-test.ts`) | projection shapes with strict `Expect<Equal<A, B>>` — no `expect-type` dependency |

Both tracks run with **zero Prisma install**. The hand-written fake delegates
(`test/helpers/fake-delegate.ts`) are simultaneously test fixtures and the
standing proof of invariant 1. A change is done only when `npm run verify`
(lint → typecheck → test → build) is green; CI runs the same gate on Node 18/20/24.

## Known gaps and change discipline

There is no defect register; known gaps live in the README (`Known limitations`
and `Behavior contracts`). The former HIGH defects — cursor/offset meta conflict,
`custom({ where })` replacing the `initialArgs` seed, nested-include types
narrower than runtime truth — are fixed with regression tests. When touching
code:

- check the change does not extend a documented limitation's code path;
- add a regression test when you fix a limitation;
- update the README (`Behavior contracts` / `Known limitations`) in the same change.

## Extension points

| Want to…                    | Do this                                                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| support a new database      | one capability entry / `registerDialect()` (skill: `add-dialect`)                                                |
| gate behavior per DB        | add a `DialectCapabilities` flag; consume via `resolveDialect().capabilities` inside the builder method           |
| add a builder method        | accept only delegate-derived types; consult the registry for per-DB behavior; add unit + type tests; re-export any new public type from `src/index.ts`; document the contract in README |
| adapt REST query params     | v2 scope (`adapters/`, separate optional entries); never inside `src/core`                                          |
| support a new Prisma major  | nothing — that is the point. The planned nightly canary CI job (M3) exists to prove it                           |

## Versioning

Semver applies to the public surface (`src/index.ts` exports) plus the documented
behavior contracts in README. Zero runtime dependencies means nothing outside this
repository can force a breaking change; the published compatibility claim is
"any delegate with the standard `findMany` call shape".

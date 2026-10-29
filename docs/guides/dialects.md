# Dialects

Prisma-supported databases disagree on what arguments they accept — most
notably `mode: 'insensitive'` on string filters, which works on PostgreSQL,
CockroachDB and MongoDB and **throws** on MySQL, MariaDB, SQLite and SQL
Server. This package encodes those differences as a capability registry: the
builder asks "what is allowed here?" instead of branching on database names,
and a new database never requires changes to the builder itself.

## Configuring the dialect

```ts
import { QueryBuilder, configureQueryBuilder } from 'query-builder-prisma';

// 1. Per builder — recommended: explicit and visible at the call site
new QueryBuilder(prisma.user, { dialect: 'postgresql' });

// 2. Global default for builders without an override
configureQueryBuilder({ dialect: 'postgresql' });
```

Resolution order (first hit wins, fails soft):

1. per-builder `dialect` option
2. global `configureQueryBuilder({ dialect })`
3. registered auto-detector — `setDialectDetector(fn)`
4. built-in detector — `detectDialect()` (a no-op in v0)
5. `'universal'` — emits only arguments valid on **every** Prisma database

```ts
resolveDialect();                          // inspect what resolved right now
// → { name: 'postgresql', capabilities: { caseInsensitiveMode: true, ... } }
```

An unregistered/unknown name resolves to `'universal'`, and the reported
`name` reflects that — the name never lies about the capabilities actually
applied.

## Built-in capability sets

| Dialect       | `caseInsensitiveMode` | `caseInsensitiveCollation` |
| ------------- | --------------------- | -------------------------- |
| `postgresql`  | `true`                | `false`                    |
| `cockroachdb` | `true`                | `false`                    |
| `mongodb`     | `true`                | `false`                    |
| `mysql`       | `false`               | `true`                     |
| `mariadb`     | `false`               | `true`                     |
| `sqlserver`   | `false`               | `true`                     |
| `sqlite`      | `false`               | `false`                    |
| `universal`   | `false`               | `false`                    |

What the flags mean in practice, e.g. for [`search()`](./filtering.md#search--case-insensitive-text-search):

- `caseInsensitiveMode: true` → the builder emits
  `{ contains: text, mode: 'insensitive' }`.
- `caseInsensitiveCollation: true` → bare `contains`; the database's default
  collation is already case-insensitive.
- Both `false` (`sqlite`, `universal`) → bare `contains`; matching is
  case-sensitive (ASCII) and Prisma offers no alternative on that database.

## Adding a database

One call registers capabilities for any database — including ones Prisma adds
in the future. No core changes are ever needed:

```ts
import { registerDialect } from 'query-builder-prisma';

registerDialect('my-future-db', {
  caseInsensitiveMode: true,
  caseInsensitiveCollation: false,
});

new QueryBuilder(prisma.thing, { dialect: 'my-future-db' }); // just works
```

A custom auto-detector (best-effort by contract — it must never throw, and an
`undefined` result falls through to `'universal'`):

```ts
import { setDialectDetector } from 'query-builder-prisma';

setDialectDetector(() => process.env.DB_PROVIDER);
```

Test/isolation helper — clears the global dialect and detector, keeps
registered entries:

```ts
import { resetDialectConfig } from 'query-builder-prisma';
resetDialectConfig();
```

## How the global state is stored

The global config lives on `globalThis` under the registered symbol
`Symbol.for('query-builder-prisma.dialect-state')`, so ESM and CJS copies of
the package in one bundler graph converge on **one** config (no dual-package
split). The per-builder `dialect` option remains the recommended path — it is
explicit, testable, and immune to global state.

## Related

- [Filtering — search()](./filtering.md#search--case-insensitive-text-search) —
  where capabilities take effect
- [API — Functions](../api/functions.md) — every registry function
- [API — DialectCapabilities](../api/types.md#dialectcapabilities)

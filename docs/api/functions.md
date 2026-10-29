# Functions and constants

Everything exported from the package root besides the `QueryBuilder` class
and the [types](./types.md): the dialect registry API and the
`NoResultError` class.

## Dialect registry

Resolution order when a builder needs capabilities: per-builder `dialect`
option → global `configQueryBuilder` → registered auto-detector → built-in
detector → `'universal'`. See [Dialects](../guides/dialects.md).

### `configQueryBuilder()`

```ts
function configQueryBuilder(options: { dialect?: string | undefined }): void
```

Sets the global default dialect for all builders that do not override it.
Unknown names fall through to `'universal'` at resolution time (they are
stored as given and validated on lookup).

```ts
configQueryBuilder({ dialect: 'postgresql' });
```

### `registerDialect()`

```ts
function registerDialect(name: string, capabilities: DialectCapabilities): void
```

Registers (or replaces) capabilities for a database — including ones Prisma
adds in the future. No core code changes are ever required to support a new
dialect.

```ts
registerDialect('my-future-db', {
  caseInsensitiveMode: true,
  caseInsensitiveCollation: false,
});
```

### `resolveDialect()`

```ts
function resolveDialect(explicit?: string | undefined): ResolvedDialect
```

Resolves the active dialect per the documented precedence. An unregistered
name resolves to `'universal'` — the reported `name` never lies about the
capabilities actually applied.

```ts
resolveDialect('postgres');
// → { name: 'universal', capabilities: { caseInsensitiveMode: false, ... } }
//    ('postgres' is not a registered name — 'postgresql' is)
```

### `setDialectDetector()`

```ts
function setDialectDetector(detector: () => string | undefined): void
```

Plugs in a best-effort auto-detector. By contract it must never throw; an
`undefined` result falls through to the built-in detector and then
`'universal'`.

```ts
setDialectDetector(() => process.env.DB_PROVIDER);
```

### `resetDialectConfig()`

```ts
function resetDialectConfig(): void
```

Test helper: clears the global dialect and the detector. Registered dialect
entries are kept.

```ts
resetDialectConfig();
```

### `detectDialect()`

```ts
function detectDialect(): Dialect | undefined
```

The built-in auto-detect hook. Returns `undefined` in v0 — callers fall
through to `'universal'`, which never emits an argument invalid on any
Prisma-supported database. Future heuristics must keep the same contract:
never throw, never guess wrong loudly.

## Constants

### `DIALECT_CAPABILITIES`

```ts
const DIALECT_CAPABILITIES: {
  postgresql: DialectCapabilities;
  cockroachdb: DialectCapabilities;
  mysql: DialectCapabilities;
  mariadb: DialectCapabilities;
  sqlite: DialectCapabilities;
  sqlserver: DialectCapabilities;
  mongodb: DialectCapabilities;
  universal: DialectCapabilities;
};
```

The built-in capability sets, one per database Prisma supports (plus
`universal`). `registerDialect()` extends the live registry;
this constant is the seed. Values: see the table in
[Dialects](../guides/dialects.md#built-in-capability-sets).

## Errors

### `NoResultError`

```ts
class NoResultError extends Error
```

Thrown by `QueryBuilder.firstOrThrow()` when no row matched. `name`:
`'NoResultError'`. See [QueryBuilder → NoResultError](./query-builder.md#noresulterror).

```ts
import { NoResultError } from 'query-builder-prisma';
```

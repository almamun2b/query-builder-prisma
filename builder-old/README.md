# 🔍 QueryBuilder

A generic, fully **type-safe query builder** for any [Prisma](https://www.prisma.io/) model delegate.  
It wraps `findMany` and `count` calls with a fluent, chainable API that supports searching, filtering, range queries, sorting, pagination, field projection, and relation eager-loading — all with TypeScript types inferred **directly from Prisma's own generated types**.

---

## 📋 Table of Contents

- [Why QueryBuilder?](#-why-querybuilder)
- [Quick Start](#-quick-start)
- [API Reference](#-api-reference)
  - [Constructor](#constructor)
  - [`.search()`](#search)
  - [`.filter()`](#filter)
  - [`.range()`](#range)
  - [`.where()`](#where)
  - [`.sortBy()`](#sortby)
  - [`.paginate()`](#paginate)
  - [`.cursorPaginate()`](#cursorpaginate)
  - [`.select()`](#select)
  - [`.include()`](#include)
  - [`.custom()`](#custom)
  - [`.buildArgs()`](#buildargs)
  - [`.execute()`](#execute)
  - [`.count()`](#count)
  - [`.executeWithMeta()`](#executewithmeta)
  - [`.executeWithCursor()`](#executewithcursor)
- [Usage Examples — Individual Methods](#-usage-examples--individual-methods)
- [Usage Examples — Grouped & Real-World](#-usage-examples--grouped--real-world)
- [How Conditions Are Combined](#-how-conditions-are-combined)
- [Type Safety Notes](#-type-safety-notes)

---

## 💡 Why QueryBuilder?

Building dynamic Prisma queries from HTTP query parameters is repetitive and error-prone. Without an abstraction you end up writing the same `if (param) andConditions.push(...)` boilerplate in every service. Compare:

**Without QueryBuilder** (~100 lines of manual condition assembly):

```ts
const andConditions: Prisma.UserWhereInput[] = [];

if (searchTerm) {
  andConditions.push({
    OR: ['email', 'username', 'firstName'].map((field) => ({
      [field]: { contains: searchTerm, mode: 'insensitive' },
    })),
  });
}
if (role) andConditions.push({ role });
if (status) andConditions.push({ status });
if (createdAtFrom || createdAtTo) {
  andConditions.push({
    createdAt: {
      ...(createdAtFrom && { gte: new Date(createdAtFrom) }),
      ...(createdAtTo && { lte: new Date(createdAtTo) }),
    },
  });
}
// ... same for lastLoginAt, dateOfBirth, avatar.size ...

const [total, data] = await Promise.all([
  prisma.user.count({ where: { AND: andConditions } }),
  prisma.user.findMany({
    where: { AND: andConditions },
    orderBy: { [sortBy]: sortOrder },
    skip: (page - 1) * limit,
    take: limit,
    select: USER_SAFE_SELECT,
  }),
]);
```

**With QueryBuilder** (~10 lines, identical behaviour):

```ts
const result = await new QueryBuilder(prisma.user)
  .search({ searchText: searchTerm, fields: ['email', 'username', 'firstName'] })
  .filter({ role, status })
  .range({
    createdAt: { from: createdAtFrom, to: createdAtTo },
    lastLoginAt: { from: lastLoginAtFrom, to: lastLoginAtTo },
    dateOfBirth: { from: dateOfBirthFrom, to: dateOfBirthTo },
    'avatar.size': { from: avatarSizeMin, to: avatarSizeMax },
  })
  .sortBy({ sortBy, sortOrder })
  .paginate({ page, limit })
  .select(USER_SAFE_SELECT)
  .executeWithMeta();
```

---

## ⚡ Quick Start

```ts
import { QueryBuilder } from 'src/app/builder/queryBuilder';
import { prisma } from 'src/app/config/prisma';

// Fetch active users — sorted, paginated, with avatar included
const { meta, data } = await new QueryBuilder(prisma.user)
  .filter({ status: 'ACTIVE' })
  .sortBy({ sortBy: 'createdAt', sortOrder: 'desc' })
  .paginate({ page: 1, limit: 20 })
  .include({ avatar: true })
  .executeWithMeta();

console.log(meta); // { page: 1, limit: 20, total: 142, totalPage: 8 }
console.log(data); // User[] with avatar relation populated
```

---

## 📖 API Reference

### Constructor

```ts
new QueryBuilder(delegate, initialArgs?)
```

| Parameter     | Type                                       | Required | Description                                           |
| ------------- | ------------------------------------------ | -------- | ----------------------------------------------------- |
| `delegate`    | Prisma model delegate (e.g. `prisma.user`) | ✅       | The Prisma model to query against                     |
| `initialArgs` | `FindManyArgs` (Prisma-inferred)           | ❌       | Optional raw `findMany` args to seed the builder with |

**Examples:**

```ts
// Basic — wraps prisma.user
const qb = new QueryBuilder(prisma.user);

// With initial args — useful for pre-seeding a base where clause
const qb = new QueryBuilder(prisma.user, {
  where: { deletedAt: null },
});
```

---

### `.search()`

```ts
.search({ searchText, fields })
```

Performs a case-insensitive `OR` match across multiple string fields.  
If `searchText` is `undefined`, `null`, or an empty string, no condition is added — safe to pass query params directly.

| Parameter    | Type                   | Description                         |
| ------------ | ---------------------- | ----------------------------------- |
| `searchText` | `string \| undefined`  | The search keyword. No-op if falsy. |
| `fields`     | `(keyof WhereInput)[]` | The model fields to search across.  |

**Individual Example:**

```ts
// Search users whose email, username, or firstName contains "john"
const users = await new QueryBuilder(prisma.user)
  .search({
    searchText: 'john',
    fields: ['email', 'username', 'firstName', 'lastName'],
  })
  .execute();
```

**Safe with undefined (no-op):**

```ts
const searchTerm = undefined; // e.g. query param not provided

const users = await new QueryBuilder(prisma.user)
  .search({ searchText: searchTerm, fields: ['email', 'username'] })
  // ↑ Adds nothing to the WHERE clause — returns all users
  .execute();
```

> [!TIP]
> Under the hood this generates: `WHERE (email ILIKE '%john%' OR username ILIKE '%john%' OR firstName ILIKE '%john%')`

---

### `.filter()`

```ts
.filter(filters)
```

Adds equality/operator filters using a partial Prisma `where` object.  
Any key whose value is `undefined` is **silently stripped**, so you can spread raw query params without guarding every field.

| Parameter | Type                              | Description                      |
| --------- | --------------------------------- | -------------------------------- |
| `filters` | Partial `WhereInput` of the model | Key/value pairs to match exactly |

**Individual Example — Exact match:**

```ts
// All ADMIN users with ACTIVE status
const users = await new QueryBuilder(prisma.user)
  .filter({ role: 'ADMIN', status: 'ACTIVE' })
  .execute();
```

**With undefined values (safely ignored):**

```ts
const role = req.query.role; // may be undefined
const status = req.query.status; // may be undefined

const users = await new QueryBuilder(prisma.user)
  .filter({ role, status }) // undefined values are stripped automatically
  .execute();
```

**Advanced Prisma operators:**

```ts
// Users whose id is NOT in a list (Prisma `notIn` operator)
const users = await new QueryBuilder(prisma.user)
  .filter({ id: { notIn: ['uuid-1', 'uuid-2'] } })
  .execute();

// Verified users only
const users = await new QueryBuilder(prisma.user).filter({ isVerified: true }).execute();
```

---

### `.range()`

```ts
.range(ranges)
```

Adds `gte` / `lte` bounds (greater-than-or-equal / less-than-or-equal).  
Keys support **dot-notation paths** to reach nested relations or objects (e.g. `'avatar.size'`).  
Either bound may be `undefined` — it will simply be skipped. If both are `undefined`, no condition is added for that field.

| Parameter | Type                             | Description                                   |
| --------- | -------------------------------- | --------------------------------------------- |
| `ranges`  | `Record<string, { from?, to? }>` | A map of field paths to `{ from, to }` bounds |

**Individual Example — Date range:**

```ts
// Users created in 2026
const users = await new QueryBuilder(prisma.user)
  .range({
    createdAt: {
      from: new Date('2026-01-01'),
      to: new Date('2026-12-31T23:59:59'),
    },
  })
  .execute();
```

**Open-ended range (only one bound):**

```ts
// Users created after 2025-06-01 with no upper bound
const users = await new QueryBuilder(prisma.user)
  .range({ createdAt: { from: '2025-06-01' } })
  .execute();
```

**Nested relation range (dot-path):**

```ts
// Users whose avatar file size is between 10 KB and 500 KB
const users = await new QueryBuilder(prisma.user)
  .range({ 'avatar.size': { from: 10_000, to: 500_000 } })
  .execute();
```

**Multiple ranges at once:**

```ts
const users = await new QueryBuilder(prisma.user)
  .range({
    createdAt: { from: '2026-01-01', to: '2026-12-31' },
    lastLoginAt: { from: '2026-06-01' },
    dateOfBirth: { to: '2000-01-01' }, // born before 2000
    'avatar.size': { from: 5_000, to: 2_000_000 },
  })
  .execute();
```

> [!NOTE]
> Dot-path keys like `'avatar.size'` are expanded into nested Prisma `where` objects automatically: `{ avatar: { size: { gte: 5000, lte: 2000000 } } }`.

---

### `.where()`

```ts
.where(condition)
```

Injects an arbitrary, fully-typed Prisma `where` condition directly into the `AND` clause.  
Use this for complex expressions (e.g. `OR`, `NOT`, nested relations) that the other helpers don't cover.

| Parameter   | Type                     | Description               |
| ----------- | ------------------------ | ------------------------- |
| `condition` | Full Prisma `WhereInput` | A raw Prisma where clause |

**Individual Example:**

```ts
// Users that are either ACTIVE or PENDING
const users = await new QueryBuilder(prisma.user)
  .where({
    OR: [{ status: 'ACTIVE' }, { status: 'PENDING' }],
  })
  .execute();
```

**Combined with other methods:**

```ts
const users = await new QueryBuilder(prisma.user)
  .filter({ role: 'USER' })
  .where({
    NOT: { email: { endsWith: '@internal.company.com' } },
  })
  .execute();
```

---

### `.sortBy()`

```ts
.sortBy({ sortBy, sortOrder })
```

Sets the `orderBy` clause. No-op if `sortBy` is not provided.

| Parameter   | Type                           | Default  | Description                              |
| ----------- | ------------------------------ | -------- | ---------------------------------------- |
| `sortBy`    | `string` (inferred from model) | —        | The field to order by. No-op if omitted. |
| `sortOrder` | `'asc' \| 'desc'`              | `'desc'` | Sort direction                           |

**Individual Examples:**

```ts
// Sort by creation date, newest first
const users = await new QueryBuilder(prisma.user)
  .sortBy({ sortBy: 'createdAt', sortOrder: 'desc' })
  .execute();

// Sort by firstName alphabetically
const users = await new QueryBuilder(prisma.user)
  .sortBy({ sortBy: 'firstName', sortOrder: 'asc' })
  .execute();

// No sortBy provided — orderBy is omitted entirely (Prisma default order)
const users = await new QueryBuilder(prisma.user)
  .sortBy({ sortOrder: 'asc' }) // no-op
  .execute();
```

---

### `.paginate()`

```ts
.paginate({ page, limit })
```

Configures `skip` and `take` from a **1-based** page number and page size.

| Parameter | Type     | Default | Description                   |
| --------- | -------- | ------- | ----------------------------- |
| `page`    | `number` | `1`     | Current page number (1-based) |
| `limit`   | `number` | `10`    | Number of records per page    |

**Individual Examples:**

```ts
// Page 2, 25 items per page → skip=25, take=25
const users = await new QueryBuilder(prisma.user).paginate({ page: 2, limit: 25 }).execute();

// Default values — page 1, 10 items
const users = await new QueryBuilder(prisma.user).paginate({}).execute();
```

> [!IMPORTANT]
> `.paginate()` must be called **before** `.execute()` or `.executeWithMeta()`.  
> Without `.paginate()`, the query returns **all matching rows** (no `skip`/`take` applied).

---

### `.cursorPaginate()`

```ts
.cursorPaginate({ cursor, limit, direction, cursorField })
```

Configures **cursor-based ("seek") pagination** — the scalable alternative to offset pagination for large or frequently-changing datasets. Instead of `skip`/`take`, it seeks from a stable cursor value, so deep pages stay fast and rows don't shift when records are inserted/deleted between requests.

Pair it with [`.executeWithCursor()`](#executewithcursor) to run the query and receive `next`/`prev` cursors. Offset [`.paginate()`](#paginate) is **untouched** — both styles coexist; if both are configured, `.cursorPaginate()` wins.

| Parameter     | Type                      | Default     | Description                                                                                   |
| ------------- | ------------------------- | ----------- | --------------------------------------------------------------------------------------------- |
| `cursor`      | `string \| undefined`     | —           | Cursor value from a previous page's `nextCursor`/`prevCursor`. Omit for the **first** page.   |
| `limit`       | `number`                  | `10`        | Page size (number of rows to return).                                                         |
| `direction`   | `'forward' \| 'backward'` | `'forward'` | `'forward'` → next page, `'backward'` → previous page.                                        |
| `cursorField` | `string` (inferred)       | `'id'`      | The **unique, sequential** column to seek on. Pair with a matching `.sortBy()` for stability. |

**First page (no cursor):**

```ts
const { data, meta } = await new QueryBuilder(prisma.user)
  .sortBy({ sortBy: 'id', sortOrder: 'asc' })
  .cursorPaginate({ limit: 20 })
  .executeWithCursor();

// meta.nextCursor → pass this to fetch the next page
// meta.hasPrevPage === false (we're on the first page)
```

**Next page (forward):**

```ts
const { data, meta } = await new QueryBuilder(prisma.user)
  .sortBy({ sortBy: 'id', sortOrder: 'asc' })
  .cursorPaginate({ limit: 20, cursor: previousMeta.nextCursor!, direction: 'forward' })
  .executeWithCursor();
```

**Previous page (backward):**

```ts
const { data, meta } = await new QueryBuilder(prisma.user)
  .sortBy({ sortBy: 'id', sortOrder: 'asc' })
  .cursorPaginate({ limit: 20, cursor: currentMeta.prevCursor!, direction: 'backward' })
  .executeWithCursor();

// Rows are returned in the SAME sort order as forward pagination,
// even though Prisma fetches them backwards under the hood.
```

**Seeking on a custom field:**

```ts
// Paginate by createdAt instead of id
const { data, meta } = await new QueryBuilder(prisma.user)
  .sortBy({ sortBy: 'createdAt', sortOrder: 'desc' })
  .cursorPaginate({ limit: 50, cursorField: 'createdAt' })
  .executeWithCursor();
```

> [!TIP]
> Under the hood, `.cursorPaginate()` over-fetches **one extra row** (`take: limit + 1`) to detect whether another page exists, sets Prisma's `cursor` + `skip: 1` (to exclude the cursor row itself), and uses a **negative `take`** for `'backward'` direction.

> [!IMPORTANT]
> Always order by the same column you set as `cursorField` (via `.sortBy()`) so the seek is deterministic. The default `cursorField` is `'id'`.

---

### `.select()`

```ts
.select(selectObject)
```

Projects specific fields using Prisma `select`. The return type of `.execute()` is **narrowed** to exactly the selected shape — no casting required.  
Calling `.select()` clears any active `.include()` (they are mutually exclusive in Prisma).

| Parameter      | Type                            | Description           |
| -------------- | ------------------------------- | --------------------- |
| `selectObject` | Prisma `SelectInput` (inferred) | The fields to project |

**Individual Example:**

```ts
// Only fetch id and email — result is typed as { id: string; email: string }[]
const users = await new QueryBuilder(prisma.user).select({ id: true, email: true }).execute();

// users[0].email  ✅ TypeScript knows this
// users[0].role   ❌ TypeScript error — role was not selected
```

**With nested relation select:**

```ts
const users = await new QueryBuilder(prisma.user)
  .select({
    id: true,
    email: true,
    avatar: {
      select: { url: true, size: true },
    },
  })
  .execute();
```

---

### `.include()`

```ts
.include(includeObject)
```

Eager-loads relations using Prisma `include`. The return type is widened with the included relations.  
Calling `.include()` clears any active `.select()`.

| Parameter       | Type                             | Description                 |
| --------------- | -------------------------------- | --------------------------- |
| `includeObject` | Prisma `IncludeInput` (inferred) | The relations to eager-load |

**Individual Example:**

```ts
// Fetch all users and include their avatar relation
const users = await new QueryBuilder(prisma.user)
  .filter({ status: 'ACTIVE' })
  .include({ avatar: true })
  .execute();

// users[0].avatar?.url  ✅ TypeScript knows avatar is included
```

**Nested include:**

```ts
const users = await new QueryBuilder(prisma.user)
  .include({
    avatar: true,
    authProviders: {
      select: { provider: true, createdAt: true },
    },
  })
  .execute();
```

---

### `.custom()`

```ts
.custom(findManyArgs)
```

Merges raw Prisma `findMany` args into the builder. Useful for options not covered by other methods — `cursor`, `distinct`, `take`, etc.

| Parameter      | Type                       | Description            |
| -------------- | -------------------------- | ---------------------- |
| `findManyArgs` | Full Prisma `FindManyArgs` | Raw args to deep-merge |

**Individual Examples:**

```ts
// Cursor-based pagination
const users = await new QueryBuilder(prisma.user)
  .custom({
    cursor: { id: 'last-seen-uuid' },
    skip: 1,
    take: 10,
  })
  .execute();

// Distinct results by email
const users = await new QueryBuilder(prisma.user).custom({ distinct: ['email'] }).execute();
```

---

### `.buildArgs()`

```ts
.buildArgs(): FindManyArgs
```

Returns the fully assembled `findMany` argument object without executing the query.  
Useful for **debugging**, logging, or reusing the args in a manual Prisma call.

**Individual Example:**

```ts
const qb = new QueryBuilder(prisma.user)
  .filter({ status: 'ACTIVE' })
  .paginate({ page: 1, limit: 10 });

// Inspect the generated args
console.log(JSON.stringify(qb.buildArgs(), null, 2));
/*
{
  "where": { "AND": [{ "status": "ACTIVE" }] },
  "take": 10,
  "skip": 0
}
*/

// Reuse the args in a manual query
const data = await prisma.user.findMany(qb.buildArgs());
```

---

### `.execute()`

```ts
async .execute(): Promise<Result[]>
```

Executes the built `findMany` query and returns the typed rows.  
The return type is inferred from `.select()` / `.include()` calls.

**Individual Example:**

```ts
const users = await new QueryBuilder(prisma.user)
  .filter({ role: 'ADMIN' })
  .select({ id: true, email: true, role: true })
  .execute();
// Type: { id: string; email: string; role: UserRole }[]
```

---

### `.count()`

```ts
async .count(): Promise<number>
```

Counts rows matching the current filters, **ignoring** pagination (`skip`/`take`) and projection (`select`/`include`).

**Individual Example:**

```ts
const totalAdmins = await new QueryBuilder(prisma.user)
  .filter({ role: 'ADMIN', status: 'ACTIVE' })
  .count();

console.log(totalAdmins); // e.g. 12
```

---

### `.executeWithMeta()`

```ts
async .executeWithMeta(): Promise<{ meta: PaginationMeta; data: Result[] }>
```

Runs **both** `count()` and `execute()` in parallel and returns the results bundled with pagination metadata.

```ts
interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPage: number;
}
```

**Individual Example:**

```ts
const { meta, data } = await new QueryBuilder(prisma.user)
  .filter({ status: 'ACTIVE' })
  .paginate({ page: 2, limit: 15 })
  .executeWithMeta();

console.log(meta);
// { page: 2, limit: 15, total: 200, totalPage: 14 }

console.log(data.length); // max 15
```

---

### `.executeWithCursor()`

```ts
async .executeWithCursor(): Promise<{ meta: CursorMeta; data: Result[] }>
```

Executes a **cursor-paginated** query (configured via [`.cursorPaginate()`](#cursorpaginate)) and returns the page rows plus forward/backward cursors. Rows are always returned in the configured sort order, regardless of `direction`. The `data` type is narrowed by `.select()`/`.include()` exactly like `.execute()`.

If `.cursorPaginate()` was not called, it defaults to a first forward page of `limit: 10` on `id`.

```ts
interface CursorMeta {
  limit: number;
  nextCursor: string | null; // pass as `cursor` (forward) for the next page
  prevCursor: string | null; // pass as `cursor` + direction:'backward' for the previous page
  hasNextPage: boolean;
  hasPrevPage: boolean;
}
```

**Individual Example:**

```ts
const { meta, data } = await new QueryBuilder(prisma.user)
  .filter({ status: 'ACTIVE' })
  .sortBy({ sortBy: 'id', sortOrder: 'asc' })
  .cursorPaginate({ limit: 10 })
  .select({ id: true, email: true })
  .executeWithCursor();

console.log(meta);
// { limit: 10, nextCursor: 'ckx...', prevCursor: 'cka...', hasNextPage: true, hasPrevPage: false }

console.log(data.length); // max 10
```

> [!NOTE]
> `nextCursor`/`prevCursor` are the `cursorField` values of the **last**/**first** row of the current page. Use `nextCursor` with `direction: 'forward'` and `prevCursor` with `direction: 'backward'`.

---

## 🧩 Usage Examples — Grouped & Real-World

### Example 1: Full User Listing Service (from `user.service.ts`)

This is the production implementation in this project — the same query that powers the `GET /api/v1/users` endpoint:

```ts
import { QueryBuilder } from 'src/app/builder/queryBuilder';
import { prisma } from 'src/app/config/prisma';
import { pick } from 'src/app/utils/pick';

const getAllUsersFromDB = async (query: TUserQueryOptions = {}) => {
  const {
    page = 1,
    limit = 10,
    sortBy = 'createdAt',
    sortOrder = 'desc',
    searchTerm,
    ...filters
  } = pick(query, [...UserConstants.USER_FILTERABLE_FIELDS]);

  const result = await new QueryBuilder(prisma.user)
    // Case-insensitive partial match across 5 fields
    .search({
      searchText: searchTerm,
      fields: ['email', 'username', 'firstName', 'lastName', 'phone'],
    })
    // Exact equality — undefined values are auto-stripped
    .filter({
      role: filters.role,
      status: filters.status,
      gender: filters.gender,
      isVerified: filters.isVerified,
    })
    // Date and numeric range filters (including nested avatar.size)
    .range({
      createdAt: { from: filters.createdAtFrom, to: filters.createdAtTo },
      lastLoginAt: { from: filters.lastLoginAtFrom, to: filters.lastLoginAtTo },
      dateOfBirth: { from: filters.dateOfBirthFrom, to: filters.dateOfBirthTo },
      'avatar.size': { from: filters.avatarSizeMin, to: filters.avatarSizeMax },
    })
    // Sort and paginate
    .sortBy({ sortBy, sortOrder })
    .paginate({ page, limit })
    // Project only safe/public fields
    .select(UserConstants.USER_SAFE_SELECT)
    // Returns rows + { page, limit, total, totalPage }
    .executeWithMeta();

  return result;
};
```

---

### Example 2: Simple Lookup with Relation Include

```ts
// Get all active users with their avatars and auth providers
const users = await new QueryBuilder(prisma.user)
  .filter({ status: 'ACTIVE', isVerified: true })
  .sortBy({ sortBy: 'firstName', sortOrder: 'asc' })
  .include({
    avatar: true,
    authProviders: { select: { provider: true } },
  })
  .execute();
```

---

### Example 3: Admin Dashboard — Recent Signups

```ts
// New users registered in the last 7 days, paginated
const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

const { meta, data } = await new QueryBuilder(prisma.user)
  .range({ createdAt: { from: sevenDaysAgo } })
  .filter({ status: 'PENDING' })
  .sortBy({ sortBy: 'createdAt', sortOrder: 'desc' })
  .paginate({ page: 1, limit: 50 })
  .select({ id: true, email: true, firstName: true, createdAt: true })
  .executeWithMeta();
```

---

### Example 4: Seeded Builder — Pre-filter Deleted Users

Use `initialArgs` or `.where()` to lock a hard constraint regardless of what other filters are applied:

```ts
// ALWAYS exclude soft-deleted users — regardless of caller filters
const builder = new QueryBuilder(prisma.user, {
  where: { deletedAt: null },
});

const { meta, data } = await builder
  .filter({ role: 'USER' })
  .paginate({ page: 1, limit: 10 })
  .executeWithMeta();
// WHERE deletedAt IS NULL AND role = 'USER'
```

---

### Example 5: Count Only (no data fetch)

```ts
// How many suspended users exist?
const suspendedCount = await new QueryBuilder(prisma.user).filter({ status: 'SUSPENDED' }).count();

console.log(`Suspended users: ${suspendedCount}`);
```

---

### Example 6: Debugging with `.buildArgs()`

```ts
const qb = new QueryBuilder(prisma.user)
  .search({ searchText: 'alice', fields: ['email', 'firstName'] })
  .filter({ role: 'ADMIN' })
  .range({ createdAt: { from: '2026-01-01' } })
  .paginate({ page: 1, limit: 5 });

// Inspect before running
console.log(JSON.stringify(qb.buildArgs(), null, 2));
/*
{
  "where": {
    "AND": [
      { "OR": [
          { "email": { "contains": "alice", "mode": "insensitive" } },
          { "firstName": { "contains": "alice", "mode": "insensitive" } }
      ]},
      { "role": "ADMIN" },
      { "createdAt": { "gte": "2026-01-01" } }
    ]
  },
  "take": 5,
  "skip": 0
}
*/

const data = await qb.execute();
```

---

### Example 7: Cursor Pagination Service (from `user.service.ts`)

The production implementation behind `GET /api/v1/users/cursor` — next/previous page navigation with no `OFFSET` scan:

```ts
const getAllUsersWithCursor = async (query: TUserQueryOptions = {}) => {
  const {
    limit = 10,
    sortOrder = 'desc',
    cursor, // from ?cursor=...
    direction = 'forward', // from ?direction=forward|backward
    searchTerm,
    ...filters
  } = pick(query, [...UserConstants.USER_FILTERABLE_FIELDS]);

  const result = await new QueryBuilder(prisma.user)
    .search({ searchText: searchTerm, fields: [...UserConstants.USER_SEARCHABLE_FIELDS] })
    .filter({ role: filters.role, status: filters.status, gender: filters.gender })
    // Seek on `id` and order by it so the cursor walk is stable
    .sortBy({ sortBy: 'id', sortOrder })
    .cursorPaginate({ cursor, limit, direction, cursorField: 'id' })
    .select(UserConstants.USER_SAFE_SELECT)
    .executeWithCursor();

  return result;
  // → { data, meta: { limit, nextCursor, prevCursor, hasNextPage, hasPrevPage } }
};
```

**Client navigation loop:**

```ts
// Page 1
let res = await fetch('/api/v1/users/cursor?limit=10');
let { data, meta } = await res.json();

// Next page
if (meta.hasNextPage) {
  res = await fetch(`/api/v1/users/cursor?limit=10&cursor=${meta.nextCursor}&direction=forward`);
}

// Previous page
if (meta.hasPrevPage) {
  res = await fetch(`/api/v1/users/cursor?limit=10&cursor=${meta.prevCursor}&direction=backward`);
}
```

---

### Example 8: Raw Cursor via `.custom()` (escape hatch)

For one-off cursor needs you can still drop down to raw Prisma args with `.custom()`:

```ts
const users = await new QueryBuilder(prisma.user)
  .filter({ status: 'ACTIVE' })
  .sortBy({ sortBy: 'createdAt', sortOrder: 'asc' })
  .custom({
    cursor: { id: 'last-page-item-uuid' },
    skip: 1, // skip the cursor item itself
    take: 10,
  })
  .select({ id: true, email: true, createdAt: true })
  .execute();
```

> [!TIP]
> Prefer `.cursorPaginate()` + `.executeWithCursor()` over `.custom()` — it computes `next`/`prev` cursors and `hasNextPage`/`hasPrevPage` for you.

---

## ⚙️ How Conditions Are Combined

All conditions added through `.search()`, `.filter()`, `.range()`, and `.where()` are collected into an `AND` array and assembled as:

```ts
{
  AND: [
    // from .where() in initialArgs (prepended first)
    { deletedAt: null },

    // from .search()
    { OR: [{ email: { contains: 'john', mode: 'insensitive' } }, ...] },

    // from .filter()
    { role: 'ADMIN' },
    { status: 'ACTIVE' },

    // from .range()
    { createdAt: { gte: new Date('2026-01-01'), lte: new Date('2026-12-31') } },
    { avatar: { size: { gte: 5000, lte: 500000 } } },

    // from .where()
    { NOT: { email: { endsWith: '@spam.com' } } },
  ]
}
```

This means:

- All top-level conditions are **ANDed** together
- The `.search()` clause uses **OR** internally across the provided fields
- `undefined` values from `.filter()` are **stripped before adding** — no empty conditions are ever generated

---

## 🔒 Type Safety Notes

- All method parameters (field names for `.search()`, `.filter()` keys, `.select()` and `.include()` shapes) are derived **directly from Prisma's generated types** via `Parameters<Delegate['findMany']>`.
- The return type of `.execute()` is `Prisma.Result<TDelegate, TArgs, 'findMany'>` — it narrows automatically based on `.select()` and `.include()` calls.
- There is **no manual type casting** needed at call sites.
- `.select()` and `.include()` are **mutually exclusive** — calling one clears the other, matching Prisma's own constraint.

# NestJS — Injection (ORMs, Raw SQL, NoSQL, Commands)

## Contents
- Scope
- TypeORM
- Prisma
- Mongoose
- MikroORM and Sequelize
- Commands, templates, dynamic code
- Fix patterns
- False positives
- Verification

Nest has no query layer of its own; injection depends on the data library. Generic SQL/NoSQL/command/template guidance lives in the `nodejs-security` skill (injection reference); this file lists the Nest-typical entry points and the ORM-specific traps.

## Scope

Entry points in Nest apps: `@Query()`/`@Param()`/`@Body()` values, GraphQL `@Args()`, WebSocket `@MessageBody()`, `@Payload()` in microservice handlers, headers (`@Headers()`), cookies. Sinks live in services/repositories. Trace from decorator parameter to sink across the controller → service → repository chain.

## TypeORM

Investigate:
- `dataSource.query(sql)`, `manager.query()`, `repository.query()` with template literals or concatenation. Parameterized form: `query('SELECT ... WHERE id = $1', [id])` (Postgres `$1`, MySQL `?`).
- `createQueryBuilder().where(\`x = '${input}'\`)`, `.andWhere(...)`, `.having(...)`, `.orderBy(userInput)`, `.groupBy(...)`, `.select(userInput)`, `.leftJoin(\`...\`)` built from strings. Safe: `.where('x = :x', { x: input })`.
- Sort/column names from the client: `orderBy(\`u.${sortBy}\`, order)` needs an allow-list (a column map), not string interpolation.
- `like`: `ILike(\`%${q}%\`)` is bound as a parameter (injection-safe, but wildcard characters are not escaped).
- `UpdateQueryBuilder`/`SoftDeleteQueryBuilder` `orderBy`/`addOrderBy` on MySQL/MariaDB did not validate the order direction: `GHSA-9ggv-8w38-r7pm`, fixed in 0.3.29 and 1.0.0.
- MySQL/MariaDB `repository.save`/`update` with object-valued fields built from user input: `CVE-2025-60542`, fixed in typeorm 0.3.26 (crafted object values in the update payload produced injectable SQL). Validate field types and upgrade.
- **Dropped filters (TypeORM 0.3.x, and 1.x only if `invalidWhereValuesBehavior` is set to `ignore`):** `findOne({ where: { id: undefined } })`, `findOneBy({ email: undefined })` and `null` conditions are omitted from the `WHERE` clause, returning the first row (typeorm issues #2500, #9316, #11873). TypeORM 1.0+ throws on `null`/`undefined` in find/repository/manager where conditions by default, but QueryBuilder `.where()` still passes them through. Check the installed major and the DataSource `invalidWhereValuesBehavior` setting before reporting. `findOneBy({ id, ownerId: user?.id })` with a missing user returns another user's record. Validate presence/type before calling, or use `findOneByOrFail` after explicit checks, and prefer explicit `IsNull()`.
- `find({ where: body })` / `findBy(query)` with client-supplied objects lets the client choose filter columns (and relations via `relations`): authorization and data exposure issue.
- `synchronize: true` in production is a data-loss/availability risk, not injection (Hardening).
- `typeorm migration:generate` template-literal code injection (`CVE-2026-73651`, fixed in 0.3.31/1.1.0) embeds database schema metadata (column comments, defaults) into generated migration code, so a hostile schema can execute code on the machine that loads the migration. Upgrade where `migration:generate` runs against databases you do not fully control.

## Prisma

- `$queryRawUnsafe`, `$executeRawUnsafe`, `Prisma.raw()` and string concatenation into `Prisma.sql` are injectable. Tagged templates `` $queryRaw`... ${value}` `` and `Prisma.sql` with `${}` parameters are bound.
- `undefined` in a filter means "no filter": `where: { email: undefined }` matches all rows, `deleteMany({ where: { id: undefined } })` can delete everything (Prisma docs warn about this; the `strictUndefinedChecks` preview feature turns it into an error). `null` is a value.
- `where: req.body`/`orderBy: query.sort` pass client-chosen fields/operators into Prisma: filter-by-hidden-field and sort-oracle issues.

## Mongoose

- `Model.find({ email: body.email, password: body.password })` with JSON bodies: `{"password": {"$ne": null}}` becomes an operator. Cast to string via DTO validation (`@IsString()`), or Mongoose's `sanitizeFilter` option (`mongoose.set('sanitizeFilter', true)` or per query), which wraps operator keys in `$eq`, on a patched Mongoose (CVE-2026-42334: `$nor` was not sanitized; fixed in 6.13.9, 7.8.9, 8.22.1, 9.1.6).
- `$where`, `$function`, `$accumulator` with input; `Model.find(req.query)`; `strictQuery` settings.
- `.populate(userInput)`, `.select(userInput)`/`.sort(userInput)`: exposes hidden fields (`+password` with `select: false`).

## MikroORM and Sequelize

- MikroORM: `em.execute(sql)` with interpolation, `qb.where(\`...\`)` or `raw()` fragments built from input; use bound parameters and `?`/`??` placeholders.
- Sequelize: `sequelize.query(\`...\`)` without `replacements`/`bind`, `Sequelize.literal(input)`, `where: { [Op.and]: input }` / operator injection when the body can contain operator keys.

## Commands, templates, dynamic code

- `child_process.exec`/`execSync`/`spawn(..., { shell: true })` with input. `execFile('tool', ['--', arg])` without a shell is safe from shell injection (but check option-like arguments).
- `eval`, `new Function`, `vm`, `require(input)`, `import(input)`.
- Handlebars/Pug/EJS rendering with `@Render()` and user-controlled template names or `res.render(view, req.body)`: see the `nodejs-security` skill (XSS and templates reference).
- Cron/queue jobs (`@nestjs/schedule`, BullMQ processors) executing job payloads: treat payloads as untrusted when producers include user input.

## Fix patterns

```ts
// Raw SQL: bind values, allow-list identifiers
const SORTS = { created: 'i.created_at', total: 'i.total' } as const;
const col = SORTS[sort as keyof typeof SORTS] ?? SORTS.created;
return this.ds.query(`SELECT i.* FROM invoices i WHERE i.owner_id = $1 ORDER BY ${col} LIMIT 50`, [user.id]);

// QueryBuilder
qb.where('invoice.ownerId = :owner', { owner: user.id }).andWhere('invoice.description ILIKE :q', { q: `%${q}%` });
```

Validate `sort`/`order` with `@IsIn([...])` in the DTO as a second layer.

## False positives

- `$1`/`?`/named-parameter binding, Prisma tagged `$queryRaw`, `ILike(\`%${q}%\`)`, repository methods with scalar values.
- Interpolated identifiers that come from a constant map or enum, not from the request.
- `find({ where: { id } })` where `id` was validated by `ParseUUIDPipe`/`@IsUUID()` and is non-undefined.
- Raw SQL in migrations or seed scripts using fixed strings.

## Verification

Use non-destructive probes in a test database: send `'` and `"` in string params and assert 400/empty results, not 500 SQL errors; send `sort=created_at;--` and `sort=(select 1)` and assert 400. Unit-test that omitting the user yields 401/404 rather than a row (the dropped-filter case).

```ts
it('does not return a row for an undefined owner', async () => {
  await expect(service.findOneForUser(invoice.id, undefined as any)).rejects.toThrow();
});
```

References: OWASP SQL Injection Prevention Cheat Sheet, https://typeorm.io, https://www.prisma.io/docs/orm/prisma-client/special-fields-and-types/null-and-undefined; CWE-89, CWE-943, CWE-78, CWE-94.

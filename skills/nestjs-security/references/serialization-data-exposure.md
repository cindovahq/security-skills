# NestJS — Serialization and Response Data Exposure

## Contents
- How serialization works in Nest
- `@Exclude` without the interceptor
- Entities returned directly
- Plain objects, query results and `@Res()`
- Safer patterns
- Other leak channels
- False positives
- Verification

Nest returns whatever a handler returns. There is no output filtering unless a serializer is registered, so a TypeORM/Mongoose/Prisma row with `passwordHash`, `mfaSecret`, `apiKey` or internal flags goes to the client as-is.

## How serialization works in Nest

`ClassSerializerInterceptor` (from `@nestjs/common`) applies `class-transformer`'s `instanceToPlain()` to the handler's return value and honors `@Exclude()`, `@Expose()`, `@Transform()` and `@SerializeOptions()` (for example `{ strategy: 'excludeAll' }` makes `@Expose()` an allow-list, `{ type: UserDto }` converts plain results to a class first). It must be **bound**: `@UseInterceptors(ClassSerializerInterceptor)` on a controller/route, or globally with `{ provide: APP_INTERCEPTOR, useClass: ClassSerializerInterceptor }` or `app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)))`. Per the docs it does not serialize `StreamableFile`.

Nest 12 adds `StandardSchemaSerializerInterceptor` with `@SerializeOptions({ schema })`: response schemas from Zod/Valibot/ArkType; `z.object()` strips undeclared properties, making the schema an allow-list. It also has to be bound.

## `@Exclude` without the interceptor

The most common finding: `@Exclude()` on `passwordHash` in the entity, but no `ClassSerializerInterceptor` anywhere (the decorator is inert without it), or it is bound on one controller while another returns the same entity.

```ts
@Entity()
export class User {
  @Column() email: string;
  @Exclude() @Column() passwordHash: string;   // inert unless the interceptor runs
}
```

Search for all return paths of user-like entities: `findOne`, `findAll`, `create`, `update`, `me`, login responses (`return { user, token }`), password reset, admin lists, GraphQL types that expose entity classes via `@ObjectType()`.

## Entities returned directly

- `repo.save(user)` returns the saved entity including hash fields; many handlers return it.
- `{ select: false }` on a column keeps it out of default finds, but `addSelect`, `save()` return values, and `create()` results can still carry it. Treat as defense in depth.
- Spreading (`{ ...user, extra }`) or `toJSON()` custom methods produce plain objects that `ClassSerializerInterceptor` cannot filter: the docs warn the handler must return a class instance (a plain object such as `{ user: new UserEntity() }` is not serialized correctly). Use `@SerializeOptions({ type })` or map to DTOs explicitly.
- Query-builder raw results (`getRawMany()`), Prisma results (plain objects, no decorators), `lean()` Mongoose documents: decorators do not apply. Use `select`/`omit` or explicit mapping.
- Relations: eager relations or `relations: ['owner']` loaded for convenience expose the related user's hash/email.

## Plain objects, query results and `@Res()`

- With `@Res()` (non-passthrough) the handler writes the response itself; interceptor result mapping does not apply to that response. `@Res({ passthrough: true })` keeps Nest's pipeline.
- Handlers returning `Promise<any>`/`any` hide shape changes: a later column added to the entity leaks automatically.
- Pagination wrappers (`{ items, total }`) are plain objects: apply `@Type(() => UserDto)` plus `@SerializeOptions({ type: PageDto })` or serialize items before wrapping.

## Safer patterns

```ts
export class UserDto {
  @Expose() id: string;
  @Expose() email: string;
  constructor(partial: Partial<UserDto>) { Object.assign(this, partial); }
}

@UseInterceptors(ClassSerializerInterceptor)
@SerializeOptions({ strategy: 'excludeAll', type: UserDto })   // allow-list
@Get('me')
me(@CurrentUser() user: User) { return new UserDto(user); }
```

Prefer explicit response DTOs (allow-list) over `@Exclude` (deny-list). Bind the serializer globally and treat any `@Res()` handler as needing manual review.

## Other leak channels

- Swagger plugin/`@ApiProperty` makes schema visible, not data; but example values and enum names can expose internals (`secrets-config.md`).
- Exception filters returning `exception.message`/`stack`, TypeORM `QueryFailedError` details (SQL, parameters), validation errors echoing values.
- Logging request bodies/headers (passwords, tokens) via `Logger` or interceptors.
- GraphQL: an `@ObjectType()` entity class exposes every `@Field()` it declares to any client that can select it. Use separate output types for sensitive entities and keep credential columns without `@Field()`.
- `@Sse()` event `data` and WebSocket `emit(entity)` payloads carry whatever object you pass; apply serialization (or map to DTOs) there too.

## False positives

- Returning an entity whose sensitive columns are not present at all (no password field on that class).
- `ClassSerializerInterceptor` bound globally and the entity class decorated with `@Exclude`; handlers returning class instances.
- Returning the caller's own data including email/phone to the caller.
- Response schemas (Nest 12 `StandardSchemaSerializerInterceptor`) that allow-list fields.

## Verification

```ts
it('never returns credential fields', async () => {
  const res = await request(app.getHttpServer()).get('/users/me').set(auth).expect(200);
  expect(res.body).not.toHaveProperty('passwordHash');
  expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|apiKey|mfaSecret/);
});
```

Run it for every endpoint returning user-like objects (list, create, update, login). Also assert a freshly added entity column does not appear (allow-list DTOs).

References: https://docs.nestjs.com/techniques/serialization (v12: /application/serialization), OWASP API3:2023 Broken Object Property Level Authorization, API8; CWE-200, CWE-213, CWE-359.

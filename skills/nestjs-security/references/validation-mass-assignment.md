# NestJS — Validation Pipes, DTOs and Mass Assignment

## Contents
- How validation works in Nest
- ValidationPipe options that matter
- When validation silently does not run
- Nested objects and arrays
- Type conversion traps
- Mass assignment
- Schema-based validation (Nest 12)
- False positives
- Verification

## How validation works in Nest

`ValidationPipe` (from `@nestjs/common`) uses `class-validator` and `class-transformer`. It validates a parameter only when the TypeScript parameter type is a **class** with decorator metadata, because it reads the type through `emitDecoratorMetadata`. It is not registered unless the app does it: `app.useGlobalPipes(new ValidationPipe(...))` in `main.ts`, an `APP_PIPE` provider, `@UsePipes()`, or `@Body(new ValidationPipe())`. Check that `main.ts` bootstrap config is the one in use (tests often skip it, see `verification.md`).

## ValidationPipe options that matter

| Option | Default | Security meaning |
|---|---|---|
| `whitelist` | off | Strips properties that have **no** validation decorator. Without it, extra body properties survive `plainToInstance` and reach services |
| `forbidNonWhitelisted` | off | With `whitelist`, rejects extra properties with 400 instead of stripping |
| `transform` | off | Returns a DTO class instance and converts `@Param`/`@Query` primitives per the handler's declared type. Without it handlers receive plain objects |
| `forbidUnknownValues` | `false` in Nest's `ValidationPipe` (the pipe sets it explicitly), `true` in `class-validator` 0.14+ | Objects of unknown class are not rejected; nested plain objects skip their rules |
| `skipMissingProperties` / `skipUndefinedProperties` / `skipNullProperties` | off | Skips rules for absent values: a "required" field becomes optional |
| `disableErrorMessages` | off | Hides constraint messages from clients (Hardening) |
| `validateCustomDecorators` | off | Custom param decorators (`@CurrentUser()`, `@Cookies()`) are not validated |
| `errorFormat` | `'list'` | Nest 12 option to shape error output |

Recommended baseline: `new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` registered globally.

## When validation silently does not run

From `ValidationPipe.toValidate()` (source): parameters whose metatype is `String`, `Boolean`, `Number`, `Array`, `Object`, `Buffer` or `Date`, or undefined, are not validated.

- `@Body() body: any`, `@Body() body: Record<string, unknown>`, inline `{ name: string }` types, `interface`/`type` aliases (erased at compile time), `Partial<User>` (a generic alias, not a class): **no validation**. The Nest docs warn that metadata is not emitted for generics or interfaces.
- `import type { CreateUserDto }` erases the class at runtime, so the metatype is `Object`.
- `@Body() dtos: CreateItemDto[]` has metatype `Array`: items are not validated. Use `new ParseArrayPipe({ items: CreateItemDto })` or a wrapper DTO with `@ValidateNested({ each: true }) @Type(() => CreateItemDto)`.
- DTO classes with no class-validator decorators at all validate nothing; with `whitelist: true` they strip every property.
- Transpilers that do not emit decorator metadata (some SWC/esbuild/Vitest setups without the right plugin) disable validation silently: a test or build change can switch it off.
- Raw access: `@Req() req` then `req.body`, `@Res()`, `@Headers()`, `@Cookies()`, `@Query() q` typed as `any`, `@Ctx()`/`@Payload()` in microservices (a `ValidationPipe` must be applied there too, throwing `RpcException`).
- Pipes run after guards; routes bound to `@UsePipes(ValidationPipe)` for POST only leave PATCH unvalidated.

## Nested objects and arrays

- Nested DTOs need `@ValidateNested()` **and** `@Type(() => ChildDto)`. Without `@Type` the nested value stays a plain object and its rules are never applied (tested on Nest 11.1: invalid and extra nested properties pass through untouched, or are all stripped when `whitelist: true`). Arrays also need `{ each: true }`.
- `whitelist` strips unknown properties of nested objects only when they are validated through `@ValidateNested` with `@Type`.
- `@IsObject()` or `@IsArray()` alone accept arbitrary content.
- Free-form JSON fields (`metadata`, `settings`) stored in JSON columns and later merged into config objects: see prototype pollution in the `nodejs-security` skill (input validation reference). `ValidationPipe` calls `stripProtoKeys` on the value before transformation (current source), which helps but does not make deep merges safe.

## Type conversion traps

- `@Query('page') page: number` with `transform: true` becomes `NaN` for `abc` unless `@IsInt()`/`ParseIntPipe` is applied.
- `transformOptions: { enableImplicitConversion: true }` uses `class-transformer` implicit conversion, where the string `'false'` converted to `Boolean` is `true` (`Boolean('false')`). Flags like `?isAdmin=false` or `isActive: 'false'` flip. Use `@Transform(({ value }) => value === 'true')` or `@IsBooleanString`.
- `@Param('id') id: string` without `ParseUUIDPipe`/`@IsUUID()`: arbitrary strings reach ORM calls and raw SQL.
- Express 5's default query parser is `simple`, so `?a[b]=1` stays a string key; an older upgraded app may set `query parser` to `extended`. Under `extended`, `@Query('x')` can arrive as an array or object and bypass `string` assumptions.

## Mass assignment

Highest-value Nest pattern. Investigate every write path:

```ts
// Vulnerable: no whitelist, entity built from the DTO instance (extra "role" survives)
const user = this.repo.create(dto);       // or Object.assign(new User(), dto), repo.save({ ...dto })
// Vulnerable: update DTO derived from a DTO that includes privileged fields
export class UpdateUserDto extends PartialType(CreateUserDto) {}   // CreateUserDto has role / isActive
// Vulnerable: untyped body written directly
@Patch(':id') update(@Param('id') id: string, @Body() body: any) { return this.repo.update(id, body); }
```

Privileged fields: `role`, `roles`, `isAdmin`, `permissions`, `emailVerified`, `isActive`, `tenantId`, `ownerId`, `balance`, `passwordHash`, `status`, `createdAt`.

Fix: separate DTOs per use case (`OmitType(CreateUserDto, ['role'] as const)` from `@nestjs/mapped-types`; `@nestjs/swagger` and `@nestjs/graphql` export their own mapped-type helpers, so import from the package in use), `whitelist` + `forbidNonWhitelisted`, and in the service copy named fields only. Set privileged fields server-side.

## Schema-based validation (Nest 12)

Nest 12 adds a `schema` option on `@Body()`, `@Query()`, `@Param()`, `@RawBody()` and `StandardSchemaValidationPipe` for Zod/Valibot/ArkType. The decorator only attaches metadata: **register `StandardSchemaValidationPipe` globally** (`app.useGlobalPipes(new StandardSchemaValidationPipe())`) or the schema is not enforced. `ValidationPipe` only validates class-typed parameters and `StandardSchemaValidationPipe` only those with a `schema`, so a project can run both and still have parameters covered by neither. Zod `z.object()` strips unknown keys; use `.strict()` to reject them.

## False positives

- `@Body() body: CreateCatDto` with a global `ValidationPipe`, even without `whitelist`, when the service copies named fields from the DTO.
- `@Param('id') id: string` passed only to a parameterized query with owner scoping.
- Missing `forbidNonWhitelisted` when `whitelist: true` is on (silent stripping is safe).
- `disableErrorMessages` not set: Hardening/Informational.

## Verification

```ts
it('ignores privileged fields on registration', async () => {
  const res = await request(app.getHttpServer()).post('/auth/register')
    .send({ email: 'new@example.test', password: 'Passw0rd!x', role: 'admin' });
  expect([201, 400]).toContain(res.status);
  const user = await users.findOneByOrFail({ email: 'new@example.test' });
  expect(user.role).toBe('user');
});
it('rejects unknown properties', () =>
  request(app.getHttpServer()).patch('/users/me').set(auth).send({ isAdmin: true }).expect(400));
```

Build the test app with the same `configureApp(app)` function used by `main.ts`.

References: https://docs.nestjs.com/techniques/validation (v12: /application/validation), https://github.com/typestack/class-validator, OWASP API3 (Broken Object Property Level Authorization); CWE-915, CWE-20.

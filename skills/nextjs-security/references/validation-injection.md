# Next.js — Input Validation, Mass Assignment and Injection

## Contents
- Untrusted inputs in a Next.js app
- Validation
- Mass assignment
- SQL / NoSQL injection
- Paths, commands and dynamic code
- File uploads
- Severity notes, false positives, verification

## Untrusted inputs in a Next.js app

All of these are attacker-controlled: Server Action arguments and `FormData`, `params` from `[segment]` folders, `searchParams`, Route Handler bodies/query/headers/cookies, `pages/api` `req.query`/`req.body`, headers forwarded by proxy, and webhook payloads before signature verification. The Next.js docs: "Folders with brackets are user input. Are params validated?" and `searchParams` must not be trusted for decisions like `?isAdmin=true`.

TypeScript types are erased at runtime. `async function f(id: number)` happily receives a string, an array or an object.

## Validation

Investigate: actions/handlers that use `formData.get(...)` as `string` without checks, `as` casts on `await request.json()`, `Number(param)` without `Number.isInteger`, `req.query.id` used where it may be `string[]`, enum-like values (`role`, `status`, `sort`) not allow-listed.

```ts
'use server'
import { z } from 'zod'

const Input = z.object({
  title: z.string().trim().min(1).max(200),
  status: z.enum(['draft', 'published']),
})

export async function createPost(_: unknown, formData: FormData) {
  const user = await requireUser()
  const parsed = Input.safeParse({ title: formData.get('title'), status: formData.get('status') })
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors }
  await db.post.create({ data: { ...parsed.data, authorId: user.id } })   // identity from the session
  return { ok: true }
}
```

Schema validation checks **shape**, not **permission**. A valid `projectId` may still belong to another tenant; authorize after parsing (see `server-actions.md`).

## Mass assignment

```ts
// investigate
await db.user.update({ where: { id: user.id }, data: Object.fromEntries(formData) })
await prisma.post.update({ where: { id }, data: await request.json() })
await db.insert(users).values({ ...body })
const { id, ...rest } = body; await Model.updateOne({ _id: id }, rest)
```

Prisma, Drizzle and Mongoose have no `$fillable`-style guard. Any column in the model can be written: `role`, `isAdmin`, `teamId`, `plan`, `emailVerified`, `credits`, `ownerId`. Also check `z.object(...).passthrough()` or `z.any()` schemas feeding writes. Fix: explicit field allow-lists (`pick`/schema with only editable fields) and server-set ownership fields.

## SQL / NoSQL injection

| Pattern | Verdict |
|---|---|
| Prisma `$queryRaw\`... ${x}\`` / `$executeRaw\`...\`` tagged templates | Parameterized. Safe for values. |
| Prisma `$queryRawUnsafe(str)` / `$executeRawUnsafe(str)` with concatenation, or `Prisma.raw(input)` | Injection. |
| Drizzle `sql\`... ${x}\`` | Parameterized. `sql.raw(input)` is injection. |
| `@vercel/postgres` / `postgres` (porsager) `sql\`...\`` tagged templates | Parameterized. `sql.unsafe(input)` is injection. |
| `pg` `client.query(\`... ${x}\`)` | Injection. Use `$1` placeholders. |
| Supabase `.or(\`name.eq.${input}\`)`, `.filter(col, op, input)` with string-built filters | PostgREST filter injection: input can add conditions. Escape or use typed methods (`.eq(col, value)`). |
| Mongoose/Mongo `find({ email: body.email })` with a JSON body | Operator injection (`{"$ne": null}`). Cast to string or validate. |
| Dynamic `orderBy: { [searchParams.get('sort')]: 'asc' }` | Allow-list column names. |

## Paths, commands and dynamic code

- `fs.readFile(path.join(process.cwd(), 'content', params.slug + '.md'))` with `[...slug]` or encoded `..` → path traversal (arbitrary file read on the server; `.env`, source). Fix: allow-list slugs or resolve and check the prefix (`path.resolve` + `startsWith(baseDir + path.sep)`).
- `child_process.exec(\`convert ${name}\`)` in actions/handlers → command injection. Use `execFile` with an argument array.
- `eval`, `new Function`, `vm.runInNewContext` on input; MDX compiled at request time from user content (`@mdx-js/mdx` `evaluate`, `next-mdx-remote` with untrusted source) executes arbitrary JS on the server. Treat user-supplied MDX as code.
- `next/og` `ImageResponse` (Node runtime) with attacker-controlled values in SVG content/attributes/styles: RCE on 16.2.0–16.3.5 (CVE-2026-94545, fixed 16.3.6).

## File uploads

- Server Actions cap request bodies at 1 MB by default (`serverActions.bodySizeLimit`); raising it to large values without per-user limits → DoS.
- Check type validation by magic bytes or a library, not `file.type` (client-controlled), random server-side names, storage outside `public/` (everything in `public/` is served as-is), and authorized download routes.
- Files written to `public/` at runtime: served on the app origin, so HTML/SVG uploads → stored XSS. Prefer object storage with `Content-Disposition: attachment`.

## Severity notes, false positives, verification

- SQL injection or path traversal reachable by unauthenticated users → Critical. Mass assignment of privilege fields → High/Critical. Missing validation with no demonstrated impact → Hardening.
- **Not findings:** tagged-template raw queries, ORM query builders with values, zod-validated inputs used as values.
- **Verify:** unit tests that call the action/handler with wrong types, extra fields (`role: 'admin'`) and traversal strings, and assert rejection and unchanged DB state.

References: OWASP A05:2025 Injection, API3:2023, API6:2023; CWE-20, CWE-89, CWE-943, CWE-915, CWE-22, CWE-78, CWE-94; https://nextjs.org/docs/app/guides/data-security, https://www.prisma.io/docs/orm/prisma-client/using-raw-sql/raw-queries.

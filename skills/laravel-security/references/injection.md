# Laravel — Injection and Deserialization

## Contents
- SQL injection
- Identifier injection (columns, tables, sort)
- OS command injection
- PHP object deserialization
- Server-side template injection and code execution
- Local file inclusion / view injection
- Other sinks
- Verification

Trace every finding: **source** (request input, route param, header, cookie, uploaded file content, imported CSV, webhook body, data previously stored by a user) → **transformations** → **sink**. Confirm the value is attacker-controlled before reporting.

## SQL injection

Eloquent and the query builder use PDO prepared statements for **values**. Injection happens where developers write raw SQL.

**Sinks:**

```php
DB::select("SELECT * FROM users WHERE email = '$email'");
DB::statement("UPDATE ... WHERE id = " . $request->id);
DB::unprepared($sql);                         // no bindings possible
User::whereRaw("name LIKE '%{$q}%'")->get();
->selectRaw("count(*) as c, $col")           // also identifiers
->orderByRaw($request->input('order'))
->havingRaw("sum(total) > $min")
->groupByRaw($request->group)
DB::raw("...$var...")                         // anywhere it's embedded
->whereRaw('id IN (' . implode(',', $ids) . ')')
```

**Safe equivalents:**

```php
DB::select('SELECT * FROM users WHERE email = ?', [$email]);
User::whereRaw('name LIKE ?', ["%{$q}%"])->get();
->whereIn('id', $ids)
->havingRaw('sum(total) > ?', [$min])
```

**Severity:** reachable unauthenticated SQLi → **Critical**. Authenticated → High. Admin-only → Medium/High depending on DB privileges and data.

Also check packages that build SQL from input: raw `->whereJsonContains` with dynamic paths, full-text search helpers, reporting/export features, and Scout database engine raw clauses.

## Identifier injection (columns, tables, sort)

Bindings can't parameterize identifiers. Laravel's grammar wraps (quotes) identifiers passed to `orderBy`, `where`, `select` etc., which blocks most classic injection. Dynamic identifiers are still dangerous:

```php
$query->orderBy($request->input('sort', 'id'), $request->input('dir', 'asc'));
$query->where($request->input('field'), $request->input('value'));
DB::table($request->table)->get();
$query->select($request->input('columns'));   // array of columns
```

**Risks:**
- **Data inference through sensitive columns.** Sorting or filtering by `password`, `remember_token`, `two_factor_secret`, `api_token` or `reset_token` lets an attacker infer those values one character at a time from result ordering or counts. The column never appears in the output, so this is easily missed. **High** when hidden secret columns are reachable.
- Selecting arbitrary columns returns hidden data unless an API Resource limits output.
- `DB::table($input)` exposes arbitrary tables.
- JSON-path syntax (`column->path`) in identifiers is parsed by the grammar. Don't rely on quoting as the control.
- Sort direction: the builder rejects directions other than `asc`/`desc` (it throws). Directions inside `orderByRaw` are not checked.

**Fix:** allow-list identifiers (`Rule::in([...])`, `match`, an enum), or use spatie/laravel-query-builder with `allowedSorts()`, `allowedFilters()`, `allowedFields()`.

## OS command injection

**Sinks:** `exec`, `shell_exec`, `system`, `passthru`, `popen`, `proc_open`, backticks, `Process::run($string)`, `Process::pipe`, `Symfony\Component\Process\Process::fromShellCommandline($string)`, plus packages wrapping CLI tools (ImageMagick, ffmpeg, wkhtmltopdf, git, zip).

```php
Process::run("convert {$request->file} -resize 200x200 out.png");   // shell parses $file
exec('ping -c 1 ' . $request->host);
```

**Safe:**

```php
Process::run(['convert', $path, '-resize', '200x200', $out]);   // argument array, no shell
// escapeshellarg() is acceptable when a string is unavoidable — verify every interpolated value is wrapped
```

Also check **argument injection**: even with an argument array, a value starting with `-` can become an option (`--output=/var/www/public/x.php`). Use `--` separators where the tool supports them, and validate the format.

Severity: reachable command injection → **Critical** (CWE-78).

## PHP object deserialization

PHP gadget chains in Laravel and common packages make deserializing attacker data a potential **RCE** (CWE-502).

**Sinks:**
- `unserialize($input)` on anything client-controlled. Includes cookies set by custom code, hidden form fields, cache entries an attacker can write, and data from external systems.
- **`decrypt($value)` / `Crypt::decrypt($value)` unserialize by default.** On values that round-trip through the client (hidden fields, URL params, custom cookies), they're only safe while `APP_KEY` stays secret. Prefer `encryptString`/`decryptString`, or `decrypt($value, false)`.
- `'serialization' => 'php'` in `config/session.php` (the Laravel 13 skeleton uses `json`). Combined with the `cookie` session driver and a leaked `APP_KEY`, this gives RCE.
- `config/cache.php` → `'serializable_classes'` (Laravel 13; skeleton default `false`). `true` or a missing key in upgraded apps allows arbitrary classes when unserializing cache entries. That matters when the cache store is shared or writable (Redis without auth, shared Memcached).
- `phar://` paths reaching filesystem functions (`file_exists`, `fopen`, `getimagesize`) with a user-controlled path on PHP < 8.0. PHP 8.0+ no longer unserializes phar metadata on most file operations.
- Queue payloads: serialized job objects. Anyone who can write to the queue backend (Redis or database without auth) can achieve RCE when a worker processes the job. Infrastructure issue; report if the backend is exposed.

Historical context: CVE-2018-15133 (Laravel ≤5.6.29) turned a leaked `APP_KEY` into RCE through cookie unserialization. Modern Laravel doesn't unserialize cookies, but leaked keys remain dangerous anywhere `decrypt()` or php session serialization is used.

## Server-side template injection and code execution

- `Blade::render($userString)` / `Blade::compileString($userString)`: Blade compiles to PHP, so user-controlled templates mean **RCE** (`{{ system('id') }}`, `@php ... @endphp`). Common in "custom email template" or "CMS page" features. **Critical.** Use a sandboxed template engine (Twig sandbox, Mustache) or simple placeholder replacement (`strtr`).
- `eval()`, `create_function()`, `assert($string)` (PHP < 8), `preg_replace` with `/e` (PHP < 7), dynamic `include`/`require`.
- Dynamic calls with user input: `call_user_func($request->fn)`, `$obj->{$request->method}()`, `app($request->class)`, `new $class` → arbitrary method/class invocation.

## Local file inclusion / view injection

- `view($request->input('page'))` / `View::make($input)`: renders any view the attacker names, potentially admin templates with sensitive data. View names use dot notation, and the finder resolves within view paths, but namespaced views (`vendor::...`) and package views are reachable. Allow-list.
- `include storage_path('...' . $input)` or `require base_path($input)` → LFI/RCE.
- `File::get(base_path($request->path))`, `file_get_contents(storage_path('app/' . $name))` → arbitrary file read with `../` (no Flysystem protection). Can read `.env` → `APP_KEY` → further compromise. **High/Critical.**

## Other sinks

- **LDAP** (`ldap_search` with interpolated filters): use `ldap_escape()` or LdapRecord's query builder.
- **XPath / XML**: `DOMDocument::loadXML` with external entities. PHP 8+ disables external entity loading by default, so XXE needs `LIBXML_NOENT` / `LIBXML_DTDLOAD` flags. Grep for those flags.
- **Header injection**: `response()->header('X-Foo', $input)`. Symfony rejects CR/LF in headers in modern versions, so this is a low priority.
- **CSV/formula injection** in exports (`=HYPERLINK(...)`, `=cmd|...`): Low. Prefix cells starting with `= + - @ \t \r` with `'` if exports are opened in spreadsheets.
- **Log injection**: user input in log lines with newlines. Low.
- **NoSQL** (jenssegers/mongodb, mongodb/laravel-mongodb): operator injection via arrays in input, e.g. `['$ne' => null]`. Validate types as scalars.

## Verification

- Static: re-run the search for sibling patterns after the fix. Psalm taint analysis (`vendor/bin/psalm --taint-analysis`) and Semgrep PHP rules can confirm no remaining source→sink flows.
- Tests: assert queries use bindings via `DB::listen` / `DB::enableQueryLog()`. Send a benign payload (`' OR '1'='1`, `id;echo`) and assert it's treated as data (no extra rows, no command side effect). Never run destructive payloads (`DROP`, `rm`, `sleep`-based DoS) against shared environments.

```php
it('treats search input as data', function () {
    Post::factory()->create(['title' => 'hello']);
    $this->getJson("/api/posts?q=' OR '1'='1")->assertOk()->assertJsonCount(0, 'data');
});
```

References: OWASP SQL Injection Prevention, OS Command Injection Defense, Deserialization Cheat Sheets; CWE-89, CWE-78, CWE-88, CWE-502, CWE-94, CWE-1336, CWE-22; https://laravel.com/docs/queries#raw-expressions, /processes, /encryption.

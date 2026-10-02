# Laravel — Input Validation and Mass Assignment

## Contents
- Validation entry points
- Using validated data
- Mass assignment
- Rule pitfalls
- Type juggling and business-logic input
- Verification

## Validation entry points

| Style | Where |
|---|---|
| Form Request | `app/Http/Requests/*Request.php` → `rules()`, `authorize()`, `prepareForValidation()` |
| Inline | `$request->validate([...])`, `Validator::make(...)` |
| Livewire | `#[Validate]` attributes, `$this->validate()` |
| Filament/Nova | Field `->rules()` definitions |

Validation is per-endpoint. Check that **every** write endpoint (including API, Livewire actions and admin panels) validates. Missing validation by itself is a robustness issue. It becomes a security finding when the unvalidated value reaches a sensitive sink (SQL, file path, HTML, privilege field, money, status).

## Using validated data

**Investigate:** handlers that validate, then use the **raw** request anyway:

```php
$request->validate(['title' => 'required|string|max:255']);
Post::create($request->all());   // extra fields (user_id, is_published, ...) pass straight through
$post->update($request->input()); // same
```

**Expected:**

```php
$data = $request->validated();                 // only keys with rules
$post = $request->user()->posts()->create($data);
// or
$post->update($request->safe()->only(['title', 'body']));
```

**Nested arrays:** `validated()` returns only keys that have rules, **except** that `'meta' => 'array'` with no child rules returns the **whole** array, including arbitrary nested keys. Constrain allowed keys: `'meta' => 'array:color,size'` or add `meta.*` / `meta.color` rules.

## Mass assignment

The model's attribute protection is the last line of defense when request data reaches `create()`, `update()`, `fill()`, `firstOrCreate()`, `updateOrCreate()`.

**Investigate:**
- `protected $guarded = [];` on models that receive request data → every column is assignable.
- `Model::unguard()` in `AppServiceProvider::boot()` → **global** loss of protection.
- `$fillable` that includes privilege or integrity fields: `role`, `is_admin`, `type`, `team_id`, `tenant_id`, `user_id`, `owner_id`, `email_verified_at`, `balance`, `credits`, `price`, `status`, `approved`, `password` (when not hashed via cast/mutator).
- `forceFill($request->...)`, `forceCreate($request->...)` bypass `$fillable`/`$guarded` entirely.
- Registration: `User::create($request->all())` with `role` in `$fillable` → anyone can register as admin. **High/Critical.**
- Profile update endpoints that allow changing `email` without re-verification, or `team_id` to join another tenant.

**Exploit condition (state it in the finding):** the request data reaches the model unfiltered (`all()`, `input()`, `except()`, or `validated()` with an over-broad array rule) **and** the sensitive column is assignable.

**Fix:** narrow `$fillable`, use `validated()`/`safe()->only()`, set privileged fields explicitly (`$user->role = Role::Member;`). In development, `Model::preventSilentlyDiscardingAttributes(! app()->isProduction())` turns silently dropped attributes into exceptions.

## Rule pitfalls

| Pattern | Problem | Better |
|---|---|---|
| `'id' => 'exists:posts,id'` | Proves existence, not ownership (IDOR) | `Rule::exists('posts','id')->where('user_id', $user->id)` or a policy |
| `'role' => 'string'` | Any role accepted | `Rule::enum(Role::class)` or `Rule::in([...])`, and check the actor may grant it |
| `'url' => 'url'` | Accepts many URL schemes unless restricted. Not sufficient for `href` safety or SSRF. | `'url' => 'url:http,https'` plus an allow-list for SSRF contexts |
| `'email' => 'email'` | Lenient RFC validation | `email:rfc,dns` (or `strict`) where it matters |
| `'file' => 'mimes:jpg,png'` | Content-based guess, but client filename/extension is still separate | See `file-uploads.md` |
| `'sort' => 'string'` | Arbitrary column names reach `orderBy` | `Rule::in(['created_at','title'])` |
| `'amount' => 'numeric'` | Negative, zero, huge or scientific notation values | `numeric|min:0.01|max:...|decimal:0,2` |
| `'regex:/.../'` | Catastrophic backtracking on user input (ReDoS) | Simple anchored patterns; length limit first |
| `sometimes` on a security field | Field skipped when absent; logic may then default to an unsafe value | `required` or an explicit default |
| `'per_page' => 'integer'` | Unbounded page size | `integer|min:1|max:100` |

`prepareForValidation()` and `passedValidation()` can modify input. Check they don't re-introduce raw values after validation.

## Type juggling and business-logic input

- Loose comparisons on input: `if ($request->code == $user->otp)`. PHP 8 removed most string-to-number juggling, but `==` between `null`, `''`, `0` and `false` still bites, e.g. `null == ''` is true. Use `hash_equals()` for secrets, `===` elsewhere.
- JSON bodies can carry arrays or booleans where strings are expected: `{"email": ["a@x.com"]}`, `{"code": true}`. Validate types (`string`, `integer`, `boolean`) on every security-relevant field.
- Money and quantities: negative quantities, integer overflow, float rounding, currency mismatch, client-supplied prices (`$request->price` used instead of `Product::find(...)->price`) → **High** in commerce flows.
- Workflow state: status transitions accepted from input (`'status' => 'approved'`) without checking the current state and actor.

## Verification

```php
it('ignores privilege fields on registration', function () {
    $this->post('/register', [
        'name' => 'x', 'email' => 'x@test.dev',
        'password' => 'Password123!', 'password_confirmation' => 'Password123!',
        'is_admin' => 1, 'role' => 'admin',
    ]);
    expect(User::whereEmail('x@test.dev')->first())
        ->is_admin->toBeFalsy()
        ->role->not->toBe('admin');
});
```

References: OWASP Mass Assignment Cheat Sheet, Input Validation Cheat Sheet, OWASP API3:2023 (BOPLA); CWE-915, CWE-20, CWE-1333; https://laravel.com/docs/validation, /eloquent#mass-assignment.

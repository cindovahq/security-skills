# Laravel — Authorization and IDOR

## Contents
- How authorization is expressed in Laravel
- Object-level authorization (IDOR)
- Function-level authorization (admin routes)
- Role/permission packages
- Livewire
- Filament / Nova / admin panels
- Multi-tenancy
- Background jobs, broadcasts, console
- Verification

Broken access control is the most common serious finding in Laravel apps. Check every route that takes an identifier.

## How authorization is expressed in Laravel

Authorization is enforced only if one of these runs on the server for the request:

| Mechanism | Example |
|---|---|
| Policy via Gate | `Gate::authorize('update', $post);` (works in any class) |
| Controller helper | `$this->authorize('update', $post);` needs the `AuthorizesRequests` trait. Laravel 11+ base `Controller` is empty, so this helper only exists if the trait was added. |
| Route middleware | `->middleware('can:update,post')` or `->can('update', 'post')` |
| Form Request | `public function authorize(): bool { return $this->user()->can('update', $this->route('post')); }` |
| Resource controller | `$this->authorizeResource(Post::class)` (≤10 style), or `HasMiddleware` + `Middleware::can(...)` (11+) |
| Scoped query | `$request->user()->posts()->findOrFail($id)` (ownership enforced by the query) |
| Model user check | `if ($post->user_id !== $request->user()->id) abort(403);` |

**Not authorization:** `@can` / `@cannot` in Blade, hiding buttons, Inertia/Vue checks, `auth` middleware alone (it authenticates; it doesn't authorize), obscure or UUID IDs (they make guessing harder but are not access control).

Policy auto-discovery maps `App\Models\Post` → `App\Policies\PostPolicy`. Check that policy methods actually compare ownership. A policy whose method returns `true` is a common finding.

## Object-level authorization (IDOR)

For every route with a parameter (`{post}`, `{id}`, `?invoice_id=`), answer: **can user A access or modify user B's record by changing the identifier?**

**Investigate:**

```php
// Implicit binding, no authorization anywhere on the path
Route::get('/invoices/{invoice}', [InvoiceController::class, 'show'])->middleware('auth');
public function show(Invoice $invoice) { return view('invoices.show', compact('invoice')); }

// Direct lookup from input
$order = Order::findOrFail($request->input('order_id'));
$doc = Document::where('id', $id)->first();

// Update/delete paths are often missed even when show() is protected
public function destroy(Comment $comment) { $comment->delete(); }
```

Trace the whole path: route middleware, controller constructor middleware (`HasMiddleware::middleware()` in 11+, `$this->middleware()` in ≤10), Form Request `authorize()`, `Gate::authorize`, and policy contents. Only report once you've confirmed none of them enforce ownership.

**Nested resources:** `/users/{user}/posts/{post}` does **not** automatically check that `$post` belongs to `$user`. Scoping is automatic only when a custom key is used for the child (`{post:slug}`) or the route/group calls `->scopeBindings()`. Without that, a user may access any post by swapping `{post}` while keeping their own `{user}`.

**Fix pattern:**

```php
public function show(Invoice $invoice)
{
    Gate::authorize('view', $invoice);      // InvoicePolicy@view: return $user->id === $invoice->user_id;
    return view('invoices.show', compact('invoice'));
}
// or
$invoice = $request->user()->invoices()->findOrFail($id);
```

**Validation rules that leak access:** `'project_id' => 'exists:projects,id'` confirms only that the project exists, not that the user may attach to it. Use `Rule::exists('projects', 'id')->where('team_id', $user->current_team_id)` or authorize afterwards.

**Severity:** reading other users' personal or financial data, or modifying or deleting it → High. Cross-tenant in B2B SaaS → High/Critical. Low-value, non-sensitive objects → Medium/Low.

## Function-level authorization (admin routes)

- Admin routes protected only by `auth` (any logged-in user) → **High**.
- Role checks done in the UI or only on the `index` route while `store`/`update`/`destroy` are unprotected.
- `Route::resource('admin/users', ...)` inside a group with `middleware(['auth'])` but no `can:`/role middleware.
- Custom middleware like `IsAdmin` registered but not applied. Check `route:list -v` or the actual route files and groups.
- `Gate::before(fn ($user) => $user->is_admin ? true : null)` is a fine pattern. `Gate::before(fn () => true)` (often left from debugging) bypasses **all** policies: Critical.
- `Gate::define('admin', fn ($user) => $user->email === 'admin@x.com')`: fragile but OK if email can't be changed to that value. Check the profile update flow.
- Privilege fields writable via mass assignment (`role`, `is_admin`, `team_id`): see `validation-mass-assignment.md`.

## Role/permission packages

`spatie/laravel-permission`:
- Middleware `role:`, `permission:`, `role_or_permission:` must be registered (Laravel 11+: alias in `bootstrap/app.php`) and applied.
- `$user->hasRole()` checks in Blade only: UI-only.
- Assigning roles from request input (`$user->syncRoles($request->roles)`) without checking the actor may grant that role → privilege escalation.
- Permission cache: after changing roles in code paths, `app()[PermissionRegistrar::class]->forgetCachedPermissions()`. Stale cache is a functional bug, rarely a vulnerability.

## Livewire

Livewire components are **public HTTP endpoints**. Treat them like controllers.

- **Every public method is callable** by the client with arbitrary arguments. Each action that reads or changes data needs its own authorization (`$this->authorize(...)` is available in Livewire components, or use `Gate::authorize`).
- **Public properties are client-controlled.** A public `$postId` or `$userId` can be changed by the client between requests. Livewire v3: mark identifiers `#[Locked]`, or store the model as a public property (Livewire locks a public Eloquent model's ID), and re-authorize on every action.
- `mount()` authorization runs only once, on initial render. Later action calls don't re-run `mount()`.
- Check the Livewire version for CVE-2025-54068 (v3.0.0-beta.1 to 3.6.3, unauthenticated RCE via property hydration; fixed in 3.6.4). See `dependencies.md`.

## Filament / Nova / admin panels

- **Filament:** in production, panel access requires the User model to implement `FilamentUser` with `canAccessPanel(Panel $panel)`. `return true;` there lets **every registered user** into the panel → High/Critical if registration is open. Resources use model policies if they exist. Check the installed version's docs for what happens when **no policy** exists. Commonly, all actions are permitted to anyone who can access the panel. Check each resource for a policy, or for `canViewAny`/`canEdit`/`canDelete` overrides.
- **Nova:** access is controlled by the `viewNova` gate in `NovaServiceProvider::gate()`. Outside the `local` environment, only users passing the gate can enter. Check the gate logic, and check `APP_ENV` in production config (`local` opens it up).
- **Telescope / Horizon / Pulse / log viewers:** gates in their service providers (`viewTelescope`, `viewHorizon`, `viewPulse`) are bypassed when `APP_ENV=local`. See `secrets-config.md`.

## Multi-tenancy

- Tenant isolation via global scopes (`static::addGlobalScope('team', ...)`): look for `withoutGlobalScopes()`, `withoutGlobalScope(...)`, raw `DB::table()` queries, and `Model::query()` in jobs/commands where the scope's auth context is missing.
- `team_id`/`tenant_id` taken from request input instead of `$request->user()->current_team_id`.
- Cache keys and file paths that aren't tenant-prefixed (`Cache::remember('dashboard-stats', ...)` shared across tenants) → cross-tenant data leak.
- stancl/tenancy and spatie/laravel-multitenancy: check tenant identification (by domain? by header?) can't be spoofed by a client-supplied header.

## Background jobs, broadcasts, console

- **Broadcast channels** (`routes/channels.php`): `Broadcast::channel('orders.{orderId}', fn ($user, $orderId) => true)` lets any authenticated user subscribe to any order's events → data leak (High if sensitive). Expected: `return $user->id === Order::findOrNew($orderId)->user_id;`.
- Jobs that act on IDs from user input should re-check authorization at dispatch time. The job itself runs without a request user.
- Signed URLs (`URL::signedRoute`) act as bearer authorization. Check expiry (`temporarySignedRoute`), that the `signed` middleware is applied, and that the URL can't be reused for other resources.

## Verification

```php
it('forbids viewing another user\'s invoice', function () {
    [$owner, $attacker] = User::factory()->count(2)->create();
    $invoice = Invoice::factory()->for($owner)->create();

    $this->actingAs($attacker)->get("/invoices/{$invoice->id}")->assertForbidden(); // or assertNotFound()
    $this->actingAs($attacker)->delete("/invoices/{$invoice->id}")->assertForbidden();
    expect(Invoice::find($invoice->id))->not->toBeNull();
});

// Livewire action authorization
Livewire::actingAs($attacker)->test(EditPost::class, ['post' => $post])
    ->call('save')->assertForbidden();
```

Test every verb (`GET`, `PUT/PATCH`, `DELETE`) and every alternate entry point (API route, Livewire action, Filament resource) for the same object.

References: OWASP Authorization Cheat Sheet, OWASP API1:2023 (BOLA), API5:2023 (BFLA); CWE-639, CWE-285, CWE-862; https://laravel.com/docs/authorization, https://livewire.laravel.com/docs/security.

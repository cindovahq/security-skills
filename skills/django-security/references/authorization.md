# Django — Authorization, IDOR and Admin

## Contents
- How Django authorization works
- Authentication-by-default (LoginRequiredMiddleware)
- Object-level access (IDOR/BOLA)
- Function-level access (BFLA)
- Forms, formsets and foreign-key injection
- Multi-tenancy
- Django admin
- Severity, false positives, verification

## How Django authorization works

Django has **authentication** (`request.user`) and **model-level permissions** (`app_label.add_model`, `change_`, `delete_`, `view_`, checked with `user.has_perm()`), plus groups and `is_staff`/`is_superuser`. It has **no built-in object-level permissions**: `ModelBackend` returns no permissions when an `obj` is passed. Object ownership checks must be written by the developer (queryset filtering, a custom check) or come from a package (`django-guardian`, `django-rules`). `has_perm()` returns `True` for every active superuser.

Entry points: function views (`@login_required`, `@permission_required`, `@user_passes_test`, `staff_member_required`), class-based views (`LoginRequiredMixin`, `PermissionRequiredMixin`, `UserPassesTestMixin`), URL include-level decorators, middleware, DRF permission classes (`drf-permissions.md`), admin `ModelAdmin.has_*_permission`, template `{% if perms.app.change_x %}` (UI only).

## Authentication-by-default (LoginRequiredMiddleware)

Django 5.1 added `django.contrib.auth.middleware.LoginRequiredMiddleware`: every view requires an authenticated user unless decorated with `login_not_required()`. It reads `login_url`/`redirect_field_name` from the `login_required` decorator but not from `LoginRequiredMixin` attributes. Investigate when present:
- Views decorated `@login_not_required` that should not be public: login/signup/reset are expected; webhooks, health checks, exports, media or API endpoints are not (webhooks need their own signature check).
- The middleware checks Django's `request.user`. Endpoints authenticated by DRF tokens, API keys or JWT inside the view see an anonymous Django user and get redirected to login. Teams often "fix" that by blanket `login_not_required` plus in-view auth, so verify every exempted view enforces something (`drf-permissions.md`).
- Placement: must come after `AuthenticationMiddleware`. Other middleware that serves content earlier in the chain (static handlers, `WhiteNoise`, health-check middleware) is not covered.
- Without the middleware (Django < 5.1 or not enabled), authentication is opt-in per view. A view missing the decorator is the finding.

## Object-level access (IDOR/BOLA)

Investigate every view, serializer and form that accepts an identifier (path, query, body, session, hidden field) and loads an object.

```python
# vulnerable: any authenticated user can read any invoice
invoice = get_object_or_404(Invoice, pk=pk)
# scoped: ownership is part of the lookup, a miss is a 404
invoice = get_object_or_404(Invoice, pk=pk, owner=request.user)
invoice = get_object_or_404(request.user.invoices, pk=pk)
```

Signals:
- `get_object_or_404(Model, pk=...)`, `Model.objects.get(pk=request.GET[...])`, `.filter(id__in=request.POST.getlist(...))`, `Model.objects.filter(pk=pk).update(...)`/`.delete()` without an owner/tenant condition.
- Generic class-based views (`DetailView`, `UpdateView`, `DeleteView`) with `model = X` or `queryset = X.objects.all()` and no `get_queryset()` that filters by `self.request.user`. `LoginRequiredMixin` only authenticates.
- Views checking ownership on `GET` but not on `POST`/`PUT`/`DELETE`, or on the HTML view but not the JSON/PDF/export sibling.
- Templates/serializers traversing relations of an object loaded without scoping (`ticket.owner.email`, `invoice.customer.phone`).
- `request.user.is_authenticated` used as if it were a permission.
- Sequential IDs are not the vulnerability; UUIDs are not the fix. Report the missing check.

Fix: put the ownership/tenant condition in the queryset (`get_queryset`, a custom manager such as `Invoice.objects.for_user(user)`), return 404 for foreign objects, and use `PermissionDenied` (403) only when existence may be revealed. For role-based access add `PermissionRequiredMixin` or `has_perm` checks in addition.

Severity: High when other users' personal, financial or confidential data can be read or changed; Critical when it spans tenants in a SaaS or exposes credentials; Medium when data is low-sensitivity or the IDs are not guessable and not leaked elsewhere (name the condition).

## Function-level access (BFLA)

`@login_required` only proves identity. Look for administrative or privileged operations protected by it alone: promoting users, toggling `is_staff`/`is_superuser`, exporting all users, impersonation ("login as"), refunds, config changes, management endpoints under `/manage/` or `/internal/`. Expect `@permission_required("app.perm", raise_exception=True)`, `@user_passes_test(lambda u: u.is_staff)`, `staff_member_required`, `PermissionRequiredMixin`, or a policy check.

Other traps:
- Mixin order: `LoginRequiredMixin`/`PermissionRequiredMixin` must be leftmost in the base-class list. Placed after `View`, the check is skipped.
- `@permission_required` without `raise_exception=True` redirects authenticated users to the login page instead of returning 403; this is a usability problem, not a bypass.
- `UserPassesTestMixin.test_func()` that returns truthy values loosely (`return request.user.role`), or a `handle_no_permission` override that returns 200.
- Decorating `get()` but not `post()`, or only decorating a method of a view reachable by another method via `http_method_names`.
- Superuser checks via client-supplied flags (`request.POST["is_admin"]`) or by comparing usernames/emails.
- URL-prefix based protection implemented in custom middleware with `request.path.startswith("/admin")`: path normalization and alternate routes can bypass it.

## Forms, formsets and foreign-key injection

`ModelChoiceField(queryset=Model.objects.all())` (and the implicit field for a `ForeignKey` in a `ModelForm`) accepts any primary key that exists. If the field should only offer the current user's objects, scope the queryset in `__init__` (`self.fields["project"].queryset = Project.objects.filter(owner=user)`), otherwise a user can attach their record to someone else's, or read other objects through the resulting relation. The same applies to DRF `PrimaryKeyRelatedField(queryset=...)`, `SlugRelatedField` and nested writes.

Model formsets and inline formsets: `queryset=` must be scoped and the submitted `id` values are validated only against that queryset. An unscoped formset lets a client edit other rows.

## Multi-tenancy

- Every tenant-owned model needs a tenant FK and every access path (views, DRF viewsets, admin, Celery tasks, signals, management commands run on request, exports, search) must filter on it. Prefer a manager that applies the filter by default, but remember that `Model._base_manager`, related-object descriptors, `select_related` and raw SQL can bypass default-manager filters.
- Cache keys, file paths and search indexes need the tenant ID too. Cross-tenant cache leakage (`cache_page` or `UpdateCacheMiddleware` on a view that varies by user) is a known pattern. Several `Vary`/`Cache-Control`/`Set-Cookie` leaks in those components were patched between May and July 2026 (CVE-2026-6907, CVE-2026-8404, CVE-2026-35193, CVE-2026-48587, CVE-2026-48588), so check the installed patch level (`dependencies.md`) and do not cache authenticated pages.

## Django admin

- URL exposure: `/admin/` at the default path is **Informational/Hardening**, not a finding. A reachable admin on the public internet without MFA, IP restriction or throttling is **Hardening to Medium** depending on the data.
- Staff access: `is_staff=True` lets a user into the admin, but each model still requires `view_`/`change_`/`add_`/`delete_` permissions. `is_superuser=True` bypasses all of them. Flag broad staff groups, shared accounts and superusers used for routine work.
- Custom admin URLs: views added in `ModelAdmin.get_urls()` must be wrapped in `self.admin_site.admin_view(...)`. Without it they are **unauthenticated** (the docs: wrapping ensures permission checks for active staff and `never_cache`). **High** if the view exposes data or actions.
- Overridden `has_*_permission` returning `True`, `ModelAdmin.get_queryset` not scoped for multi-tenant staff, `list_display`/`readonly_fields` that render sensitive fields (password hashes, tokens), `mark_safe` in `list_display` callables with model data (`xss.md`), `save_model` that trusts form data.
- Django admin has had low-severity privilege issues: `CVE-2026-4277` (`GenericInlineModelAdmin` add permission not checked on forged POST), `CVE-2026-4292` (`list_editable` allowed creating instances via forged POST), `CVE-2026-15920` (admin rendered a stored `URLField` value with a dangerous scheme as a link; fixed Aug 2026 in 6.1, 6.0, 5.2). Check patch level in `dependencies.md`.
- `django.contrib.admindocs` and `django-debug-toolbar` reachable by staff only or not at all in production.

## Severity, false positives, verification

False positives: object checks done in a custom manager, `get_queryset` or a DRF permission class on the same route; views intentionally public; `@login_required` on a view that only shows the caller's own data (`request.user` used throughout); `has_object_permission` not called on list views when `get_queryset` is scoped.

Verify with the test client, two users, and the same URL:

```python
def test_cannot_read_other_users_invoice(client, django_user_model):
    a = django_user_model.objects.create_user("a", password="pw-a-123456")
    b = django_user_model.objects.create_user("b", password="pw-b-123456")
    inv = Invoice.objects.create(owner=a, total=10)
    client.force_login(b)
    assert client.get(f"/billing/invoices/{inv.pk}/").status_code == 404

def test_non_staff_cannot_promote(client, django_user_model):
    u = django_user_model.objects.create_user("u", password="pw-u-123456")
    client.force_login(u)
    assert client.post(f"/manage/users/{u.pk}/staff/", {"is_staff": "1"}).status_code in (302, 403)
    u.refresh_from_db(); assert not u.is_staff
```

Also list routes and check each is protected: `python manage.py show_urls` (django-extensions) or walk `get_resolver().url_patterns` in a shell.

References: OWASP Top 10:2025 A01 Broken Access Control, API1/API5 (BOLA/BFLA); CWE-639, CWE-862, CWE-863; https://docs.djangoproject.com/en/stable/topics/auth/default/, https://docs.djangoproject.com/en/stable/ref/contrib/admin/, https://docs.djangoproject.com/en/stable/ref/middleware/#django.contrib.auth.middleware.LoginRequiredMiddleware.

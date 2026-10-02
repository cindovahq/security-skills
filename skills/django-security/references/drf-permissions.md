# Django REST framework — Authentication, Permissions and Object Access

## Contents
- DRF defaults to know
- Permission evaluation model
- What to investigate
- Fix patterns
- Severity, false positives, verification

## DRF defaults to know

Verify against the installed DRF (3.16 to 3.18 as of 2026-10; 3.18 dropped Django 4.2, 5.0 and 5.1; 3.17.2 and later fix two 2026 advisories, see `dependencies.md`). From the DRF settings reference:

| Setting | Default |
|---|---|
| `DEFAULT_AUTHENTICATION_CLASSES` | `SessionAuthentication`, `BasicAuthentication` |
| `DEFAULT_PERMISSION_CLASSES` | `AllowAny` (unrestricted) |
| `DEFAULT_THROTTLE_CLASSES` | `[]` |
| `DEFAULT_RENDERER_CLASSES` | `JSONRenderer`, `BrowsableAPIRenderer` |
| `DEFAULT_PAGINATION_CLASS` | `None` |

So an app that never sets `DEFAULT_PERMISSION_CLASSES` has **every endpoint public** unless each view sets `permission_classes`. With Django's `LoginRequiredMiddleware` (5.1+) enabled, anonymous (no-session) requests to DRF views are redirected to login before DRF permissions run, so the `AllowAny` default is exposed only on views marked `login_not_required`. The middleware sees only Django's session user, so token/JWT clients are redirected too, and teams often exempt API views wholesale: check every `login_not_required` DRF view for explicit permission classes (`authorization.md`).

## Permission evaluation model

- Every class in `permission_classes` must pass. Combinators: `A & B`, `A | B`, `~A` (DRF 3.9+). `IsAuthenticated | IsOwner` allows any authenticated user because the first branch passes.
- `has_permission(request, view)` runs for every request at the start of the view. `has_object_permission(request, obj)` runs **only when the code calls `self.get_object()` / `check_object_permissions(request, obj)`**. Generic views do this for retrieve, update and destroy, **not for list views** (DRF docs: queryset filtering is the developer's job), and **not for object creation** (docs: enforce in the serializer or `perform_create`). Function-based `@api_view` views and custom `get_object()` overrides must call it explicitly.
- Custom permission classes should deny by default. `SAFE_METHODS` is `GET`, `HEAD`, `OPTIONS`; a class returning `True` for safe methods exposes reads to everyone.
- `IsAdminUser` means `is_staff`, not `is_superuser`. `DjangoModelPermissions` requires add/change/delete model permissions but, by default, **not** `view` for `GET`; override `perms_map` or use `DjangoModelPermissions` with a subclass that maps `GET` to `view`. `DjangoObjectPermissions` needs an object-permission backend (`django-guardian`).
- `@action(detail=True)` methods call `get_object()` only if the code does. Extra actions also inherit class-level `permission_classes` unless overridden per action; check per-action overrides (`@action(permission_classes=[...])`) that loosen access.

## What to investigate

1. **Defaults:** `REST_FRAMEWORK` missing `DEFAULT_PERMISSION_CLASSES`, or set to `AllowAny`; views with `permission_classes = []`, `[AllowAny]`, or `authentication_classes = []` that mutate data.
2. **Unscoped querysets (IDOR/BOLA):** `queryset = Model.objects.all()` on a `ModelViewSet`/`RetrieveUpdateDestroyAPIView` with only `IsAuthenticated`. Any logged-in user can read and modify any row, and list returns everyone's. The fix is `get_queryset()` filtering by `request.user` or tenant, not a class-level `queryset` alone:
   ```python
   class TicketViewSet(viewsets.ModelViewSet):
       serializer_class = TicketSerializer
       permission_classes = [IsAuthenticated]
       def get_queryset(self):
           return Ticket.objects.filter(owner=self.request.user)
       def perform_create(self, serializer):
           serializer.save(owner=self.request.user)
   ```
3. **Object permissions that never run:** `has_object_permission` defined on a permission class used on a list route or on a custom view that fetches the object with `Model.objects.get()`; reliance on it for create.
4. **Viewset surface:** `ModelViewSet` exposes list, create, retrieve, update, partial_update and destroy. Read-only data should use `ReadOnlyModelViewSet` or mixins. `DefaultRouter` also publishes an API root listing endpoints.
5. **Function-level:** staff or admin-only operations (user management, exports, impersonation, "set role") using only `IsAuthenticated` (`authorization.md` → BFLA).
6. **Authentication classes:**
   - `BasicAuthentication` kept from the defaults on a public API: credentials sent on every request, browsers cache them, over HTTP they are cleartext. **Low/Hardening** over HTTPS; **Medium+** otherwise.
   - `TokenAuthentication`: one non-expiring token per user stored in plaintext in `authtoken_token` (the docs point to Knox for expiry); `obtain_auth_token` has no throttling or permissions by default. Tokens must travel over HTTPS only. Report unlimited-lifetime tokens as **Hardening/Low** unless there is no revocation path or tokens appear in URLs or logs.
   - JWT (`djangorestframework-simplejwt`): defaults are `ACCESS_TOKEN_LIFETIME` 5 minutes, `REFRESH_TOKEN_LIFETIME` 1 day, `ALGORITHM` HS256, `SIGNING_KEY` = `SECRET_KEY`, `ROTATE_REFRESH_TOKENS` and `BLACKLIST_AFTER_ROTATION` off. Review long lifetimes, `SIGNING_KEY` sharing with `SECRET_KEY`, signature verification disabled in custom code (`jwt.decode(token, options={"verify_signature": False})`, accepting `none`), and missing revocation on logout/password change.
   - Custom authentication classes that trust headers (`X-User-Id`, `X-Forwarded-User`) or compare keys with `==` (use `hmac.compare_digest`).
   - API keys stored in plaintext or compared with `==`; keys without scopes.
7. **Session + token mix:** views listing both `SessionAuthentication` and `TokenAuthentication` are fine; CSRF applies only on the session path (`csrf.md`).
8. **Serializer-level authorization:** `PrimaryKeyRelatedField(queryset=Model.objects.all())` lets clients attach foreign objects (`authorization.md`); validate ownership in `validate_<field>()`.

## Fix patterns

```python
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.SessionAuthentication",
                                       "rest_framework.authentication.TokenAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.AnonRateThrottle",
                                 "rest_framework.throttling.UserRateThrottle"],
    "DEFAULT_THROTTLE_RATES": {"anon": "30/min", "user": "300/min"},
}
```

Opt out explicitly and narrowly for the few public endpoints (`permission_classes = [AllowAny]` with a comment explaining why). Add role/permission classes for privileged actions. Keep ownership in `get_queryset`, and use `has_object_permission` as a second layer.

## Severity, false positives, verification

Severity: unauthenticated read/write on sensitive data **Critical/High**; authenticated cross-user read/write **High**; admin-only function reachable by any user **High/Critical**; missing throttling alone **Medium/Low**.

False positives: a public endpoint that is intentionally public and read-only (health, public catalog); `TokenAuthentication` views without CSRF; `AllowAny` on login/registration with throttling; object permission classes on detail routes combined with a scoped `get_queryset` on list routes; `permission_classes` set by a project-wide base class (find and read it).

Verify with `APIClient`:

```python
from rest_framework.test import APIClient

def test_anonymous_gets_401_or_403():
    assert APIClient().get("/api/accounts/").status_code in (401, 403)

def test_user_cannot_touch_other_users_ticket(user, other_ticket):
    c = APIClient(); c.force_authenticate(user)
    assert c.get(f"/api/tickets/{other_ticket.pk}/").status_code == 404
    assert c.patch(f"/api/tickets/{other_ticket.pk}/", {"status": "closed"}).status_code == 404
    assert other_ticket.pk not in [t["id"] for t in c.get("/api/tickets/").json()["results"]]
```

Use `force_authenticate` for permission tests. For CSRF behavior use `APIClient(enforce_csrf_checks=True)` with session login.

References: OWASP API Security Top 10 (API1, API2, API5); CWE-284, CWE-639, CWE-862; https://www.django-rest-framework.org/api-guide/permissions/, https://www.django-rest-framework.org/api-guide/authentication/, https://django-rest-framework-simplejwt.readthedocs.io/en/latest/settings.html.

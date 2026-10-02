# Django — API Security (DRF throttling, filtering, exposure, webhooks)

## Contents
- Data exposure
- Throttling and resource limits
- Filtering, search and ordering
- Browsable API, schema and docs endpoints
- Webhooks
- Real-time and GraphQL
- CORS for APIs
- Severity, false positives, verification

Authentication and permission classes are in `drf-permissions.md`. Mass assignment in serializers is in `validation-mass-assignment.md`.

## Data exposure

- `ModelSerializer` with `fields = "__all__"`, `exclude`, or `depth > 0` returns every column, including password hashes, tokens, internal notes, MFA secrets and foreign keys' full rows. Define output serializers with explicit fields. **High** when secrets or other users' PII are exposed.
- `SerializerMethodField`, `source="user.profile.secret"`, nested serializers and `to_representation` overrides that merge unrelated data.
- Returning `model_to_dict(obj)`, `serializers.serialize("json", qs)`, `values()` without a field list, or `Model.__dict__` from plain Django views.
- Errors: `DEBUG=True` stack traces (`secrets-config.md`), DRF validation errors echoing internal values, `500` pages with SQL, `str(exc)` returned to clients, ORM `DoesNotExist` messages with IDs.
- Existence oracles: different status/message for "not yours" (403) vs "not found" (404); user lookup endpoints returning whether an email exists.
- Versioned or legacy endpoints (`/api/v1/`) lacking the controls added to `/v2/`; DRF routers exposing every registered viewset.
- Logging full request bodies or `Authorization` headers.

## Throttling and resource limits

DRF throttling is off by default (`DEFAULT_THROTTLE_CLASSES = []`). Its docs say the built-in throttles "should not be considered a security measure or protection against brute forcing or denial-of-service attacks": they use the Django cache with non-atomic operations, and attackers can spoof IPs. Treat them as fairness controls and keep real limits at the proxy/WAF.

- Client identity: `AnonRateThrottle` and `UserRateThrottle` identify clients by `X-Forwarded-For` if present, otherwise `REMOTE_ADDR`; set `NUM_PROXIES` to the number of trusted proxies. Behind a proxy without it, either everyone shares one bucket (outage) or attackers rotate a forged header (bypass).
- The default cache is per-process `LocMemCache`; with multiple workers the effective limit is multiplied. Use a shared cache (Redis/Memcached) for throttle counts.
- `ScopedRateThrottle` (`throttle_scope`) and, from DRF 3.18, the `@throttle_scope` decorator for function-based views; the login/token/reset/OTP endpoints need their own scopes.
- Pagination: with `LimitOffsetPagination`, `max_limit` defaults to `None`, so `?limit=1000000` returns everything (`default_limit` comes from `PAGE_SIZE`). `PageNumberPagination` and `CursorPagination` have `page_size_query_param = None` by default; if it is enabled, set `max_page_size`. `DEFAULT_PAGINATION_CLASS` defaults to `None`, so list endpoints return whole tables unless set. **Medium/Low** (DoS, bulk scraping); High if it exposes bulk PII to a low-privilege account.
- Request size: DRF before 3.17.2 did not enforce Django's `DATA_UPLOAD_MAX_MEMORY_SIZE` when parsing `request.data` for JSON and urlencoded bodies (CVE-2026-73228, medium, fixed in 3.17.2). Large nested JSON, deeply nested serializers and `many=True` bulk endpoints deserve explicit limits.
- Expensive operations (exports, report generation, search with `icontains` across many columns, nested serializer N+1) without throttling or async offload.

## Filtering, search and ordering

- `OrderingFilter`: when `ordering_fields` is not set, clients may order by any **readable serializer field**; with a `fields="__all__"` serializer that includes `password`. `ordering_fields = "__all__"` allows any model field and annotation; the DRF docs say to use it only when the queryset has no sensitive data. Sorting by secrets is a character-by-character oracle (**High** when secret columns exist). Set `ordering_fields = [...]`.
- `SearchFilter.search_fields` may traverse relations (`owner__email`) and JSON keys with `__`, and a `$` prefix (`iregex`) lets clients supply regular expressions (DRF warns about CPU exhaustion). Including sensitive columns (`password`, tokens, notes) makes them searchable.
- `django-filter`: `filterset_fields = [...]` or a `FilterSet` with `Meta.fields` list. `Meta.fields = "__all__"`, `Meta.exclude`, or relation lookups (`owner__password`) widen the query surface. Declared filters with `lookup_expr="regex"` or `"icontains"` on huge tables are DoS-prone.
- Custom `filter_queryset`/`get_queryset` that does `qs.filter(**self.request.query_params.dict())` (`injection.md`).
- Filters must run on top of a scoped queryset (`drf-permissions.md`). A filter backend does not replace authorization.

## Browsable API, schema and docs endpoints

- `BrowsableAPIRenderer` is in DRF's default renderers: production APIs expose HTML forms for write methods, schema hints and links. It is not a vulnerability by itself. Report **Hardening** and recommend `DEFAULT_RENDERER_CLASSES = ["rest_framework.renderers.JSONRenderer"]` in production. DRF before 3.15.2 had an XSS in its `break_long_headers` template filter (CVE-2024-21520). `AdminRenderer` (not default) could disclose GET-protected data when rendering invalid write requests (CVE-2026-73229, medium, fixed in 3.17.2).
- Schema/Swagger/Redoc endpoints (`drf-spectacular`, `drf-yasg`, DRF's `get_schema_view`) list every route, including internal ones. `drf-spectacular`'s `SERVE_PERMISSIONS` default is `AllowAny` and `SERVE_PUBLIC` is `True`. Require authentication or disable in production if the API is not public. **Low/Medium**.
- Django Debug Toolbar, `silk`, `django-extensions` runserver_plus (Werkzeug debugger = RCE) in production images.

## Webhooks

Incoming webhooks are `csrf_exempt` by necessity, so authenticity must come from a **signature**.

Investigate: no signature check, a shared secret in the URL only, comparing signatures with `==`, signing a re-serialized body (`json.dumps(request.data)`) instead of the raw bytes (`request.body`), no timestamp tolerance (replay), no event-id idempotency (double fulfillment), trusting fields in the body to select amounts or accounts, and secrets hard-coded in code. Provider SDK helpers (`stripe.Webhook.construct_event(payload, sig_header, secret)`) verify correctly.

```python
@csrf_exempt
@require_POST
def provider_webhook(request):
    expected = hmac.new(settings.WEBHOOK_SECRET.encode(), request.body, hashlib.sha256).hexdigest()
    supplied = request.headers.get("X-Signature-256", "").removeprefix("sha256=")
    if not hmac.compare_digest(expected, supplied):
        return HttpResponseForbidden()
    event = json.loads(request.body)
    # check event["id"] not processed; check timestamp within tolerance; then act
```

Severity: an unsigned webhook that marks orders paid, grants entitlements or changes accounts is **Critical/High**. Outgoing webhooks to user-supplied URLs are SSRF (`ssrf-redirects.md`).

## Real-time and GraphQL

- Django Channels: wrap routers in `AuthMiddlewareStack` and `AllowedHostsOriginValidator` (cross-site WebSocket hijacking); authorize in `connect()` and on every message; scope group names per tenant/user (`f"user_{self.scope['user'].pk}"`, never client-chosen group names); Redis channel layer reachable only internally.
- GraphQL (`graphene-django`, `strawberry-django`, `ariadne`): resolver-level authorization, query depth/complexity limits, disabled introspection and GraphiQL in production, batching limits, N+1 DoS, mutation mass assignment.
- Server-sent events/long polling endpoints that skip the permission classes used by the REST views.

## CORS for APIs

Django has no built-in CORS; `django-cors-headers` is the common package. With `CORS_ALLOW_ALL_ORIGINS = True` and `CORS_ALLOW_CREDENTIALS = True` it reflects the caller's origin with credentials, so any website can read authenticated responses from cookie-based sessions. Pure bearer-token APIs are not exposed to that (browsers do not attach the header). Rate the finding by the authentication mode, as in `secrets-config.md`.

## Severity, false positives, verification

False positives: public read-only APIs with intentional `AllowAny` and pagination limits; missing throttles when a gateway enforces them (name it); `BrowsableAPIRenderer` on an internal tool; `ordering_fields` left at default on a serializer with explicit non-sensitive `fields`; webhook endpoints with verified signatures and `csrf_exempt`.

Verify:

```python
def test_pagination_is_capped(api_client, user, many_tickets):
    api_client.force_authenticate(user)
    r = api_client.get("/api/tickets/", {"limit": 100000}).json()
    assert len(r["results"]) <= 100

def test_cannot_order_by_password(api_client, admin_user):
    api_client.force_authenticate(admin_user)
    r = api_client.get("/api/accounts/", {"ordering": "password"})
    assert r.status_code == 200 and "password" not in r.json()["results"][0]  # and ordering must be ignored

def test_webhook_requires_signature(client):
    assert client.post("/billing/webhooks/pay/", data="{}", content_type="application/json").status_code == 403
```

```bash
pip-audit -r requirements.txt     # DRF >= 3.17.2 for the two 2026 advisories
```

References: OWASP API Security Top 10 (API3, API4, API8, API10); CWE-200, CWE-770, CWE-345, CWE-346; https://www.django-rest-framework.org/api-guide/throttling/, https://www.django-rest-framework.org/api-guide/filtering/, https://www.django-rest-framework.org/api-guide/pagination/, https://github.com/encode/django-rest-framework/security/advisories.

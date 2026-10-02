# Django — Verifying Findings and Fixes

## Contents
- Ground rules
- Static commands
- Test-client recipes
- DRF recipes
- Running-environment checks
- Verification matrix
- Regression tests worth keeping

## Ground rules

- Read-only analysis first. Run inspection commands (`check`, `shell` reads, `pip-audit`, `bandit`), not ones that mutate (`migrate`, `loaddata`, `flush`, `createsuperuser`, `collectstatic` into live paths). Use the test database (`pytest-django` or `manage.py test`) for anything that writes.
- Dynamic requests only against environments the user owns or is authorized to test, with test accounts and benign probes (`'"><x>`, a harmless `' OR '1'='1` in a search box). No brute force, no load, no real user data.
- State what was **not** run. A traced code path is **Confirmed** (code), not "exploited".
- Django's test client uses the host `testserver` (added to `ALLOWED_HOSTS` automatically in tests), skips CSRF by default, and runs middleware, so it exercises real routing and permissions.

## Static commands

```bash
python manage.py check --deploy --settings=<prod settings>      # security.W0xx settings checks (secrets-config.md)
python manage.py shell -c "from django.conf import settings as s; print(s.DEBUG, s.ALLOWED_HOSTS, s.MIDDLEWARE)"
python manage.py show_urls                                        # django-extensions; or walk django.urls.get_resolver()
pip-audit -r requirements.txt                                     # dependencies.md
bandit -r . -ll -x tests                                          # B608 raw SQL, B602/B605 shell, B301 pickle, B506 yaml, B703 mark_safe
semgrep --config p/django --config p/python .                     # optional
```

Grep signals (investigation only):

```bash
grep -rnE "\.raw\(|\.extra\(|RawSQL\(|cursor\(\)|shell=True|pickle\.load|yaml\.load\(|mark_safe\(|\|safe|csrf_exempt|AllowAny|__all__|objects\.get\(pk=|get_object_or_404\([A-Za-z]+, (pk|id)=[a-z_.]+\)|request\.(GET|POST)\.dict\(\)|\*\*request\." --include=*.py --include=*.html .
```

## Test-client recipes

```python
import pytest
from django.test import Client

@pytest.fixture
def users(django_user_model):
    return (django_user_model.objects.create_user("alice", password="pw-alice-123456"),
            django_user_model.objects.create_user("bob", password="pw-bob-123456"))

def test_idor(client, users):                       # authorization.md
    alice, bob = users
    obj = Invoice.objects.create(owner=alice, total=1)
    client.force_login(bob)
    assert client.get(f"/billing/invoices/{obj.pk}/").status_code == 404

def test_csrf_enforced(users):                       # csrf.md
    c = Client(enforce_csrf_checks=True); c.force_login(users[0])
    assert c.post("/accounts/profile/", {"email": "a@example.com"}).status_code == 403

def test_host_header_rejected(client):               # secrets-config.md
    assert client.get("/", HTTP_HOST="evil.invalid").status_code == 400

def test_search_does_not_widen_results(client, db):   # injection.md
    Article.objects.create(title="alpha", published=True)
    r = client.get("/kb/search/", {"q": "zzz' OR '1'='1"})   # benign probe
    assert r.status_code == 200 and b"alpha" not in r.content

def test_upload_blocked(client, users):              # file-uploads.md
    from django.core.files.uploadedfile import SimpleUploadedFile
    client.force_login(users[0])
    r = client.post("/support/upload/", {"file": SimpleUploadedFile("a.html", b"<b>x</b>", "text/html")})
    assert r.status_code == 400

def test_security_headers(client):                   # secrets-config.md
    r = client.get("/", secure=True)
    assert r["X-Content-Type-Options"] == "nosniff" and r["X-Frame-Options"] == "DENY"
```

Notes: `client.get(..., secure=True)` simulates HTTPS. `override_settings(DEBUG=False)` for error-page behavior. `RequestFactory` skips middleware, so it cannot prove middleware-based controls such as CSRF, login-required or security headers.

## DRF recipes

```python
from rest_framework.test import APIClient

def test_default_permission_denies_anonymous():       # drf-permissions.md
    assert APIClient().get("/api/accounts/").status_code in (401, 403)

def test_queryset_is_scoped(users):
    alice, bob = users
    t = Ticket.objects.create(owner=alice, title="x")
    c = APIClient(); c.force_authenticate(bob)
    assert c.get(f"/api/tickets/{t.pk}/").status_code == 404
    assert t.pk not in [i["id"] for i in c.get("/api/tickets/").json()["results"]]

def test_privileged_fields_are_read_only(users):      # validation-mass-assignment.md
    c = APIClient(); c.force_authenticate(users[0])
    c.patch(f"/api/accounts/{users[0].pk}/", {"is_staff": True}, format="json")
    users[0].refresh_from_db(); assert not users[0].is_staff
```

`APIClient(enforce_csrf_checks=True)` plus `client.login()` proves session-auth CSRF behavior on API routes; `force_authenticate` bypasses authentication classes, so it proves permissions only.

## Running-environment checks

Only in an authorized staging environment:

```bash
curl -sI https://staging.example.com/ | grep -iE 'strict-transport|x-frame|x-content-type|content-security|referrer|set-cookie'
curl -s -o /dev/null -w "%{http_code}\n" -H 'Host: attacker.invalid' https://staging.example.com/        # expect 400
curl -s -o /dev/null -w "%{http_code}\n" https://staging.example.com/admin/login/                          # reachability, not a finding by itself
curl -s -o /dev/null -w "%{http_code}\n" https://staging.example.com/this-does-not-exist-12345/            # DEBUG on => verbose 404 page
```

A debug 404 page (a list of URL patterns, "You're seeing this error because you have DEBUG = True") confirms `DEBUG=True` without any exploit.

## Verification matrix

| Finding class | Prove the issue | Prove the fix |
|---|---|---|
| IDOR / queryset scope | Two users, same URL, read/write another's object | Same test returns 404/403; scoped `get_queryset` or lookup includes the owner |
| BFLA | Non-privileged user hits admin-type route | 403 or redirect; user unchanged afterwards |
| SQL injection | Code trace from request value to the SQL string; a quote-containing probe widens results or raises a SQL error (`CaptureQueriesContext` shows the executed SQL) | Value passed through `params`; the same probe returns nothing |
| `order_by` / lookup abuse | `?sort=password` or `?owner__password__startswith=` changes order/results | Allow-list rejects it (400 or ignored) |
| Mass assignment | POST/PATCH with extra privileged field | Field ignored; `refresh_from_db()` shows no change |
| XSS | Render a page with `<script>` marker in stored data | Response contains `&lt;script&gt;`; `javascript:` links not rendered |
| CSRF | `Client(enforce_csrf_checks=True)` POST without token succeeds | 403 |
| Open redirect | `?next=https://other.example.net/` yields that `Location` | Location is relative or allowed host |
| SSRF | Request to an internal/metadata address is attempted (use a harmless listener) | Blocked by allow-list and IP validation; redirects not followed |
| Upload / traversal | Upload `.html`/`..` names; `?file=../x` returns content | Rejected; stored name server-generated; path containment check |
| Webhook | Unsigned POST changes state | 403 without a valid signature |
| Pickle / unsafe loader | Code trace to `pickle.loads`/`yaml.load` of request data | JSON + schema validation; `yaml.safe_load` |
| Settings | `check --deploy`, `settings.*` values | Warnings gone; flags set from environment |
| Dependencies | `pip-audit` lists CVE and installed version | Clean audit on the upgraded lock file |

## Regression tests worth keeping

Authorization matrix tests for every object type (owner, other user, staff, anonymous); a settings test asserting `DEBUG`, cookie flags, `SECRET_KEY` length and `ALLOWED_HOSTS` in the production module; a URL walker that fails on unexpected `csrf_exempt` or `AllowAny` views; `pip-audit` in CI (its non-zero exit on findings fails the job).

References: Django testing docs https://docs.djangoproject.com/en/stable/topics/testing/tools/, pytest-django https://pytest-django.readthedocs.io/, DRF testing https://www.django-rest-framework.org/api-guide/testing/, OWASP Web Security Testing Guide.

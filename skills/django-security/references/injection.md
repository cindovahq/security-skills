# Django — Injection and Deserialization

## Contents
- ORM defaults
- Raw SQL APIs
- User-controlled field names, lookups and ordering
- Dictionary expansion and SQL-injection advisories
- Command injection
- Deserialization
- Template and path injection
- Severity, false positives, verification

## ORM defaults

Querysets build SQL with parameters bound by the database driver. `filter(title__icontains=q)`, `filter(pk=pk)`, `exclude()`, `get()`, `Q()`, `F()` with constants, `values()`, `annotate(x=Count("y"))`, `bulk_create`, and `Model.objects.create(**validated)` with **values** from users are safe against SQL injection. The Django security overview states that querysets are parameterized and that `raw()`, `extra()`, `RawSQL` and `cursor.execute()` need care. Do not report ORM calls whose only user input is a value.

## Raw SQL APIs

```python
Article.objects.raw(f"SELECT * FROM kb_article WHERE title LIKE '%{q}%'")            # injectable
Article.objects.raw("SELECT * FROM kb_article WHERE category_id = %s", [cat_id])     # safe
Model.objects.extra(where=[f"name = '{name}'"])                                        # injectable
Model.objects.extra(where=["name = %s"], params=[name])                                # safe
qs.annotate(v=RawSQL("select col from t where c = %s", (value,)))                       # safe; f-string version is not
with connection.cursor() as cur: cur.execute(f"... {x}")                               # injectable
cur.execute("... WHERE id = %s", [x])                                                  # safe
```

Rules from the docs: pass values through `params`; do not quote placeholders (`'%s'` is unsafe); use `%s` for every parameter type; `%` characters meant literally need `%%` when params are used. Placeholders cannot be used for table, column or ORDER BY identifiers: allow-list those (`if sort not in {"created", "title"}`).

Signals: `.raw(`, `.extra(`, `RawSQL(`, `cursor.execute(`, `connection.execute_wrapper`, f-strings, `%` or `.format()` building SQL, string concatenation with `request.`, and `ORDER BY` fragments passed to `extra(order_by=[...])`/`raw`. Also `QuerySet.extra(select=...)` which is injectable in the same way. The docs call `extra()` a last resort.

Severity: unauthenticated SQL injection in a search or login path **Critical**; authenticated **High**; with strict DB privileges and no sensitive data **Medium**. Confirmed means the user input reaches the string unmodified.

## User-controlled field names, lookups and ordering

Field names and lookup paths are resolved by the ORM, including **relation traversal**, so they are not SQL injection but they are an access-control and data-oracle problem.

- `order_by(request.GET["sort"])`, `order_by(*request.GET.getlist("sort"))`: the client can sort by `password`, `owner__password`, `api_token`, `reset_token`, `mfa_secret`. Sorting is an oracle that leaks hash or token prefixes by comparing order, even if the response never contains the field. Rate **High** when plaintext secrets (API keys, tokens, reset or MFA codes) exist on the model or reachable relations; **Medium** when the only secret is a salted password hash (the oracle leaks ordering, not a usable credential) or there are no secret columns. Fix with an allow-list mapping (`SORTS = {"newest": "-created_at", "title": "title"}`; `qs.order_by(SORTS.get(key, "-created_at"))`).
- `filter(**request.GET.dict())`, `exclude(**filters)`, `Q(**filters)`: the client chooses fields, lookups (`startswith`, `regex`, `contains`) and relations (`owner__password__startswith=`, `comments__author__email__icontains=`). Boolean answers reveal secrets character by character and cross tenant boundaries even when the base queryset is scoped. Rate **High** when sensitive columns are reachable, otherwise Medium. Fix: key allow-list or a `django-filter` `FilterSet` with explicit `Meta.fields`.
- `values(*request.GET.getlist("f"))`, `values_list(user_field)`, `only()`/`defer()`, `annotate(**user)`, `alias(**user)`, `aggregate(**user)`, `distinct(user_field)`, `select_related(user)`, `prefetch_related(user)`, `F(user_field)`, `getattr(obj, user_attr)`: same class (field disclosure, sometimes errors that leak schema).
- `QuerySet.order_by("?")` is expensive (DoS on large tables), not an injection.
- Admin `ModelAdmin.lookup_allowed()` controls which changelist filters staff may use; overriding it to return `True` opens relation traversal for staff (CVE-2026-15307 shows spatial lookups reachable through it).

## Dictionary expansion and SQL-injection advisories

Django fixed several real SQL injections reachable when a **dictionary with attacker-controlled keys is expanded as `**kwargs`** into ORM methods. If you see `Model.objects.filter(**data)`, `annotate(**data)`, `alias(**data)`, `aggregate(**data)`, `extra(**data)`, `values(**data)`, `Q(**data)` where `data` comes from a request, check the installed version against the table. Fixed versions come from the Django security release posts.

| CVE | Area | Fixed in (5.2 line unless noted) |
|---|---|---|
| CVE-2025-57833 (Sep 2025) | `FilteredRelation` aliases via `annotate()`/`alias()` `**kwargs` | 5.2.6, 4.2.24 |
| CVE-2025-59681 (Oct 2025) | `annotate()`, `alias()`, `aggregate()`, `extra()` aliases on MySQL/MariaDB | 5.2.7, 4.2.25 |
| CVE-2025-64459 (Nov 2025) | `_connector` kwarg in `filter()`, `exclude()`, `get()`, `Q()` | 5.2.8, 4.2.26 |
| CVE-2025-13372 (Dec 2025) | `FilteredRelation` aliases on PostgreSQL | 5.2.9, 4.2.27 |
| CVE-2026-1287 (Feb 2026) | control characters in aliases via `annotate()`, `aggregate()`, `extra()`, `values()`, `values_list()`, `alias()` | 6.0.2, 5.2.11, 4.2.28 |
| CVE-2026-1312 (Feb 2026) | `order_by()` with periods in aliases plus `FilteredRelation` | 6.0.2, 5.2.11, 4.2.28 |
| CVE-2026-1207 (Feb 2026) | PostGIS raster lookups with untrusted band index | 6.0.2, 5.2.11, 4.2.28 |
| CVE-2024-42005 (Aug 2024) | `values()`/`values_list()` on `JSONField` with crafted JSON key | Aug 2024 security releases (4.2 and 5.0 lines) |

Report an exploitable pattern on an affected version as **High/Critical**; on a patched version the dict-splat is still a lookup-abuse finding (above). `pip-audit` confirms versions (`dependencies.md`). Django 4.2 is end-of-life (last SQL-injection fixes in 4.2.28, February 2026; last security release 4.2.30, April 2026), so an app still on 4.2 will not get later fixes.

## Command injection

`subprocess.run(f"convert {path} ...", shell=True)`, `os.system`, `os.popen`, `Popen(..., shell=True)`, `commands`-style string concatenation, `subprocess.run(cmd.split())` with user tokens, and argument injection through values that start with `-` (`git`, `tar`, `curl`, `ffmpeg`, `convert`). Common homes: Celery tasks and management commands invoked from views, export/archive endpoints, image/PDF conversion, report generation, git/CI helpers. Fix: argument lists with `shell=False`, `--` before untrusted arguments, filename allow-lists, and never interpolate request data into the command. **Critical/High**; Celery tasks inherit the caller's data (`background-tasks.md`).

## Deserialization

| Source | Risk |
|---|---|
| `pickle.loads`, `pickle.load`, `cPickle`, `dill`, `joblib.load`, `shelve`, `marshal.loads` on request, cookie, file, queue or cache data | Remote code execution. **Critical** if reachable. |
| `yaml.load(data)` without `Loader=yaml.SafeLoader`, `yaml.unsafe_load`, `FullLoader` on untrusted input | Object construction / RCE. Use `yaml.safe_load`. |
| Django cache backends | Values are pickled (Django docs). Anyone with write access to the cache store (open Redis/Memcached, `FileBasedCache` directory inside a web-writable or media path) gets code execution on read. Treat the cache as trusted storage. |
| Sessions | `PickleSerializer` removed in 5.0; check custom serializers and 4.2 apps (`sessions.md`). |
| Celery | JSON is the default `task_serializer` and `accept_content` since 4.0. `pickle` in `accept_content` plus an untrusted broker is RCE (`background-tasks.md`). |
| `django.core.serializers.deserialize(...)` on user data (json, xml, yaml, python formats) | Creates arbitrary model instances with attacker-chosen fields and primary keys. Mass assignment at model level. XML deserialization had a DoS (CVE-2025-64460). Never feed it untrusted uploads; `loaddata` is for trusted fixtures. |
| `django.core.signing.loads()` / `TimestampSigner` | Safe against tampering without `SECRET_KEY`; payloads are JSON. Use `salt=` per purpose and `max_age`. A known key allows forgery. |
| `jsonpickle`, `PyYAML` tags, `lxml` with `resolve_entities` | Use `defusedxml` for untrusted XML. |

## Template and path injection

- `django.template.Template(user_string).render(context)` / `Engine.from_string(user_string)`: user-controlled templates can read anything in the context (`{{ settings.SECRET_KEY }}` if `settings` or `request` objects are passed; Django templates cannot call methods with arguments or access dunder attributes, which limits but does not remove impact). **Medium/High** by context content. With the Jinja2 backend, `jinja2.Template(user)` or a non-sandboxed environment is code execution: **Critical**.
- `render(request, request.GET["template"])`, `get_template(user_value)`, `{% include var %}` with user-controlled `var`: loads any template on the template path (information disclosure, sometimes admin templates). Allow-list names.
- `mark_safe`/`|safe` XSS: see `xss.md`. Email: Django rejects newlines in headers (`BadHeaderError`), but build `EmailMessage` objects, never raw SMTP strings.
- Path handling: `open(os.path.join(base, user))`, `FileResponse(open(user_path))`, `zipfile.extractall`, `tarfile.extractall` (see `file-uploads.md`).
- NoSQL/LDAP: operator injection when raw JSON from `request.data` is passed to pymongo `find()` or LDAP filters (`escape_filter_chars`).

## Severity, false positives, verification

False positives: ORM calls with user values; `raw()` or `cursor.execute()` with `params`; `extra()` with `params`; `order_by` with allow-listed names; `subprocess.run([...])` argument lists with no shell and no leading-dash risk; `yaml.safe_load`; `signing.loads`; `pickle` of trusted data produced and consumed inside one trust boundary (state which); dict-splat of server-built dictionaries.

Verify:

```python
def test_search_is_parameterized(client, db):
    Article.objects.create(title="alpha", published=True)
    r = client.get("/kb/search/", {"q": "x' OR '1'='1"})       # benign probe
    assert r.status_code == 200 and "alpha" not in r.content.decode()

def test_sort_is_allowlisted(client, user):
    client.force_login(user)
    r = client.get("/directory/", {"sort": "password"})
    assert r.status_code in (200, 400) and "password" not in str(r.context.get("sort", ""))
```

```bash
bandit -r . -ll                      # B608 raw SQL, B602/B605 shell, B301 pickle, B506 yaml.load
semgrep --config p/django .          # optional
grep -rnE "\.raw\(|\.extra\(|RawSQL\(|cursor\(\)|shell=True|pickle\.load|yaml\.load\(" --include=*.py .
```

References: OWASP Top 10:2025 A05 Injection; CWE-89, CWE-78, CWE-502, CWE-1336; https://docs.djangoproject.com/en/stable/topics/security/#sql-injection-protection, https://docs.djangoproject.com/en/stable/topics/db/sql/, https://docs.djangoproject.com/en/stable/releases/security/.

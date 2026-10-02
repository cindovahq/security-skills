# Django — Dependencies, Support Status and Advisories

## Contents
- Support status (as of 2026-10-02)
- Reading the installed versions
- Notable Django advisories
- Notable DRF advisories
- Auditing commands
- Dependency hygiene and supply chain
- Severity and verification

## Support status (as of 2026-10-02)

From https://www.djangoproject.com/download/ and PyPI. Re-check before relying on these dates.

| Django | Latest patch | Security fixes until | Python |
|---|---|---|---|
| 4.2 LTS | 4.2.30 (2026-04-07) | **Ended April 2026** | |
| 5.0, 5.1 | | Ended (5.1's last security release was 2025-12-02) | |
| 5.2 LTS | 5.2.17 | April 2028 | 3.10 to 3.14 |
| 6.0 | 6.0.8 | April 2027 | 3.12 to 3.14 |
| 6.1 (released 2026-08-05) | 6.1.1 | December 2027 | 3.12 to 3.14 |
| 6.2 LTS | planned April 2027 | | |

After 6.2, versions use calendar numbering (Django 2028, 2029), each with three years of support. Django only fixes the latest patch of each supported series, so being on `5.2.3` is a finding even though 5.2 is supported (the version in `requirements.txt` or the lock file must be a current patch).

Support findings:
- App on Django 4.2, 5.0 or 5.1: **Medium** (unsupported, no security patches). **High** if a specific advisory below applies and the vulnerable feature is used. Recommend moving to 5.2 LTS (or 6.1).
- App on a supported series but an old patch: **Medium/Low** unless an advisory applies (cite the CVE and the fixed patch version).
- Python version also matters: check the interpreter's EOL (https://devguide.python.org/versions/) and the Django-supported range.

## Reading the installed versions

Prefer the lock file over the constraint: `requirements*.txt` pins, `poetry.lock`, `uv.lock`, `Pipfile.lock`, `pdm.lock`. If only unpinned requirements exist (`Django>=4.2`), say the installed version is unknown (**Likely**), and recommend a lock file with hashes. Also look at `Dockerfile` base images and `pip install` lines, CI deployment scripts, `.python-version`/`runtime.txt`.

Record security-relevant packages: `djangorestframework`, `django-filter`, `djangorestframework-simplejwt`, `django-allauth`, `django-cors-headers`, `django-storages`, `channels`, `celery`, `django-axes`/`django-ratelimit`, `Pillow`, `PyYAML`, `requests`/`urllib3`/`httpx`, `cryptography`, `gunicorn`/`uvicorn`/`daphne`, `whitenoise`, editors (`django-ckeditor`, `tinymce`), `django-debug-toolbar`, `django-extensions`.

## Notable Django advisories

From https://docs.djangoproject.com/en/stable/releases/security/ (verified 2026-10-02). Check the installed patch against the fixed versions. `pip-audit` is the source of truth.

| CVE | Date | Summary | Fixed (examples) |
|---|---|---|---|
| CVE-2026-15307 | 2026-08 | File write / request forgery via spatial lookups (GDALRaster), reachable through admin changelist filters by staff with view permission; high | 6.1 (final), 6.0.8, 5.2.17 |
| CVE-2026-15920 | 2026-08 | Admin renders stored `URLField` values with dangerous schemes as links (XSS) | 6.1 (final), 6.0.8, 5.2.17 |
| CVE-2026-48588, CVE-2026-8404, CVE-2026-35193, CVE-2026-48587, CVE-2026-6907 | 2026-05 to 07 | `UpdateCacheMiddleware`/`cache_page` caching private responses (Set-Cookie, `Cache-Control`, `Vary`) | 6.0.5 to 6.0.7, 5.2.14 to 5.2.16 |
| CVE-2026-35192 | 2026-05 | Session fixation via cached public pages with `SESSION_SAVE_EVERY_REQUEST` | 6.0.5, 5.2.14 |
| CVE-2026-6873 | 2026-06 | `get_signed_cookie` salt collision; unambiguous salt derivation, with legacy cookies still accepted by default (`SIGNED_COOKIE_LEGACY_SALT_FALLBACK`); 6.1 turns the fallback off by default | 6.0.6, 5.2.15 |
| CVE-2026-33033 | 2026-04 | `MultiPartParser` DoS via base64 uploads with excessive whitespace (any server, WSGI or ASGI); moderate | 6.0.4, 5.2.13, 4.2.30 |
| CVE-2026-33034, CVE-2026-5766 | 2026-04 to 05 | Upload limit bypass (ASGI only); low | 6.0.4 / 5.2.13 / 4.2.30 (33034) and 6.0.5 / 5.2.14 (5766) |
| CVE-2026-3902 | 2026-04 | ASGI header spoofing via underscores | 6.0.4, 5.2.13, 4.2.30 |
| CVE-2026-1287, CVE-2026-1312, CVE-2026-1207 | 2026-02 | SQL injection: crafted dict expansion in aliases; `order_by` plus `FilteredRelation`; PostGIS raster band index | 6.0.2, 5.2.11, 4.2.28 |
| CVE-2025-64459 | 2025-11 | SQL injection via `_connector` in `filter()`/`exclude()`/`get()`/`Q()` | 5.2.8, 4.2.26 |
| CVE-2025-59681, CVE-2025-57833, CVE-2025-13372 | 2025-09 to 12 | SQL injection in column aliases (`annotate`, `alias`, `aggregate`, `extra`, `FilteredRelation`) | 5.2.6, 5.2.7, 5.2.9 (4.2: 4.2.24, 4.2.25, 4.2.27) |
| CVE-2025-13473 | 2026-02 | Username enumeration timing in mod_wsgi auth handler | 6.0.2, 5.2.11, 4.2.28 |
| CVE-2025-48432 | 2025-06 | Log injection via unescaped request path | June 2025 security releases |

Django publishes security releases on a regular cadence (the next is scheduled for 2026-10-06: 6.1.2, 6.0.9, 5.2.18), so treat "latest patch" in this table as a floor and confirm the current one at https://docs.djangoproject.com/en/stable/releases/security/.

Reachability matters: GIS advisories apply only if `django.contrib.gis` is used; ASGI advisories only under ASGI; cache advisories only with the cache middleware or `cache_page`; SQL-injection ones only where attacker-controlled dictionary keys reach ORM kwargs (`injection.md`).

## Notable DRF advisories

DRF latest is 3.18.1 (2026-09-07) and supports Django 5.2, 6.0 and 6.1 (3.18 dropped Django 4.2, 5.0 and 5.1; 3.17 dropped Python 3.9 and `coreapi`).

| Advisory | Summary | Affected / fixed |
|---|---|---|
| CVE-2026-73228 (GHSA-2m8g-3cmr-wg3w) | Bypass of `DATA_UPLOAD_MAX_MEMORY_SIZE` when parsing JSON and urlencoded `request.data`; medium | up to 3.17.1 / 3.17.2 |
| CVE-2026-73229 (GHSA-g47c-3xmw-q6m2) | `AdminRenderer` may disclose GET-protected data when rendering invalid write requests; medium | up to 3.17.1 / 3.17.2 |
| CVE-2024-21520 | XSS in the `break_long_headers` template filter (Browsable API) | before 3.15.2 / 3.15.2 |

3.17.0 also refactored token generation to the `secrets` module and prevented a small risk of `Token` overwrite. Treat DRF 3.15 and 3.16 as outdated; recommend 3.17.2 or later.

## Auditing commands

```bash
pip-audit -r requirements.txt            # advisories from PyPI/OSV; also: pip-audit (current env), pip-audit --locked (pyproject/lock where supported)
pip list --outdated
python -m django --version && pip show djangorestframework
osv-scanner --lockfile=poetry.lock       # alternative
python manage.py check --deploy
bandit -r . -ll                          # static hints, not dependencies
```

No network or tool? Read the lock file and compare against https://docs.djangoproject.com/en/stable/releases/security/, https://github.com/advisories?query=ecosystem%3Apip and https://osv.dev. Say that no automated audit ran.

## Dependency hygiene and supply chain

- Development/debug packages in production requirements: `django-debug-toolbar`, `django-extensions` (Werkzeug debugger via `runserver_plus`), `silk`, `ipython`, `faker`, test factories. Combine with `DEBUG`/`INTERNAL_IPS` issues.
- Unpinned or range-only requirements, no lock file, no hashes (`pip-compile --generate-hashes` and `pip install --require-hashes`), `--extra-index-url` (dependency confusion), direct VCS or URL dependencies on moving branches, `pip install` of unpinned latest in Dockerfiles. **Hardening/Low** unless combined with an advisory.
- Abandoned or unmaintained security-sensitive packages (auth, JWT, uploads, sanitizers, editors): confirm on PyPI/GitHub before calling them abandoned; recommend migration as Hardening/Medium.
- Containers: running as root, `latest` base tags, secrets baked into layers, `.env` copied into images, dev server (`runserver`) as the CMD (the deployment checklist says `runserver` is not for production).
- Front-end assets: npm packages bundled by Django Compressor/Vite; run `npm audit --omit=dev` for runtime libraries.

## Severity and verification

Severity: unsupported framework **Medium** (raise with a reachable advisory); outdated patch with matching reachable advisory **High/Critical** per advisory; abandoned package **Low/Medium**; "outdated" with no advisory **Info**. Do not report "old" as "vulnerable" without a matching advisory.

Verification after upgrades: `pip-audit` clean; test suite green; deprecation warnings reviewed (`python -W error::DeprecationWarning manage.py test`, Django's `RemovedIn...Warning` classes; in 6.1 these are renamed to calendar versions such as `RemovedInDjango2028Warning`); `python manage.py check --deploy`.

References: OWASP Top 10:2025 A03 Software Supply Chain Failures, A08 Software or Data Integrity Failures; CWE-1104, CWE-1395; https://docs.djangoproject.com/en/stable/internals/release-process/, https://www.djangoproject.com/download/#supported-versions, https://github.com/encode/django-rest-framework/security/advisories.

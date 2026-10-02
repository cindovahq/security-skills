# Django — Background Tasks, Celery and Management Commands

## Contents
- Task systems in Django projects
- What to investigate
- Fix patterns
- Severity, false positives, verification

## Task systems in Django projects

- **Celery** (`celery.py`, `@shared_task`, `@app.task`, `CELERY_*` settings, workers, beat, Flower). JSON is the default `task_serializer` and `accept_content` is `{'json'}` since Celery 4.0 (earlier defaults were pickle). Celery's own security guide recommends restricting `accept_content` and offers an `auth` serializer that signs messages with certificates (it does not encrypt).
- **Django Tasks** (`django.tasks`, Django 6.0+): `TASKS` setting, `@task` decorator, `.enqueue()`. Django defines tasks, validates arguments and stores results, but does not execute them in production: the built-in `ImmediateBackend` and `DummyBackend` are for development and testing, and production needs a third-party backend and worker. Task arguments and results must be JSON-serializable and round-trip through `json.dumps`/`json.loads`, which keeps pickle out of the picture.
- **RQ, Huey, Dramatiq, APScheduler, cron + management commands, signals (`post_save`) that enqueue work**.

Tasks run outside the request: no `request.user`, no CSRF, no permission classes. Whatever authorization was applied at enqueue time must be carried in the arguments and re-checked, or the task needs to be safe on its own.

## What to investigate

1. **Command and code injection in task bodies:** `subprocess.run(f"...{arg}...", shell=True)`, `os.system`, `eval`/`exec`, `pickle.loads(arg)`, `Template(arg)` where `arg` came from a view, a webhook or a model field users control (`injection.md`). Task code is often written assuming trusted callers, then wired to a request later. **Critical/High** when attacker data reaches a shell.
2. **Serialization and broker exposure:** `CELERY_TASK_SERIALIZER = "pickle"`, `CELERY_ACCEPT_CONTENT` containing `pickle`/`yaml`/`msgpack` unnecessarily, `result_serializer = "pickle"`. Broker/result backends (Redis, RabbitMQ, SQS) exposed without authentication or TLS, or reachable from untrusted networks: anyone who can publish to the queue can run any registered task, and with pickle can execute code. **Critical** when pickle is accepted and the broker is reachable by an attacker; **Medium/Hardening** when only JSON is accepted but the broker is open (arbitrary task invocation with attacker arguments).
3. **IDOR in tasks:** `@shared_task def export(user_id, report_id)` that loads `Report.objects.get(pk=report_id)` without checking it belongs to `user_id`; endpoints that enqueue tasks with client-supplied IDs; results retrievable by task ID without ownership checks (`AsyncResult(task_id)` exposed at `/tasks/<id>/` leaks results; task IDs are UUIDs, not authorization).
4. **Secrets in arguments and logs:** passwords, tokens, API keys, PII passed as task args end up in the broker, the result backend, worker logs, Flower and error trackers such as Sentry. Pass IDs and fetch secrets inside the task.
5. **Flower and monitoring UIs:** Flower on a public port without authentication (`--basic_auth`, OAuth) exposes task arguments, workers and control actions. Same for RabbitMQ management, Redis Commander, RQ dashboard, Django RQ admin. **High** if reachable.
6. **Resource abuse:** user-triggered tasks without rate limits, retries without backoff (`autoretry_for` with `max_retries=None`), tasks that fetch user URLs (`ssrf-redirects.md`), unbounded file processing (`file-uploads.md`).
7. **Always-eager and test settings in production:** `CELERY_TASK_ALWAYS_EAGER = True` runs tasks inside the request thread (timeouts, error exposure); not a security issue by itself.
8. **Management commands:** `call_command(user_value, ...)` or `management.call_command` with a client-chosen command name or options; commands invoked via `subprocess.run(["python", "manage.py", *user_args])` (argument injection); `loaddata` on uploads (`injection.md`, deserialization).
9. **Signals and model hooks:** `post_save` handlers that enqueue tasks with unsanitized model fields and run privileged actions (sending email with attacker-controlled templates or recipients, calling admin APIs).
10. **Email tasks:** attacker-controlled `to`/`from`/`headers` allow spam relay and phishing from your domain; Django rejects newlines in headers, but recipient lists built from user input still need checks. With `EMAIL_USE_TLS`, a failed STARTTLS handshake could leave a connection that was later reused to send mail unencrypted, notably with `fail_silently=True` (CVE-2026-7666, fixed June 2026); stay patched.

## Fix patterns

```python
# settings.py (Celery)
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"
CELERY_BROKER_URL = os.environ["CELERY_BROKER_URL"]          # rediss:// or amqps:// with credentials

# tasks.py
@shared_task
def export_tickets(owner_id: int, export_id: int) -> None:
    export = Export.objects.get(pk=export_id, owner_id=owner_id)     # authorization lives in the task too
    subprocess.run(["tar", "czf", str(export.archive_path), "-C", str(export.source_dir), "."], check=True)
```

Keep brokers on private networks with authentication and TLS, run workers as unprivileged users, avoid pickle everywhere, protect Flower, and treat task names as an API.

## Severity, false positives, verification

False positives: tasks that receive only server-generated arguments; `subprocess.run([...])` with a constant executable and validated arguments; broker without authentication on `localhost` inside a single-host container network (state the condition); `CELERY_TASK_ALWAYS_EAGER` in test settings; JSON-only serializers behind a private broker.

Verify:

```bash
python -c "from myproject.celery import app; print(app.conf.task_serializer, app.conf.accept_content, app.conf.result_serializer, app.conf.broker_url.split('@')[-1])"
celery -A myproject inspect registered          # which tasks an attacker with queue access could call
nmap -p 5672,6379,5555 <host>                    # only on systems you are authorized to scan: broker/Flower exposure
```

```python
def test_export_task_scopes_to_owner(db, user, other_user_export):
    with pytest.raises(Export.DoesNotExist):
        export_tickets(user.pk, other_user_export.pk)
```

References: OWASP Top 10:2025 A05/A08; CWE-78, CWE-502, CWE-639, CWE-306; https://docs.celeryq.dev/en/stable/userguide/security.html, https://docs.djangoproject.com/en/stable/topics/tasks/.

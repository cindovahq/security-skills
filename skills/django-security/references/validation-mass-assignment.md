# Django — Validation and Mass Assignment

## Contents
- Where Django validates (and where it does not)
- Mass assignment in forms
- Mass assignment in DRF serializers
- Dict-splat into the ORM
- Type and shape confusion
- Severity, false positives, verification

## Where Django validates (and where it does not)

Validation lives in **forms** (`Form`, `ModelForm`: `clean_<field>()`, `clean()`, field validators) and **DRF serializers** (field validators, `validate_<field>()`, `validate()`). Model field validators (`EmailValidator`, `URLValidator` on `URLField`, `choices`, `MinValueValidator`, ...) run in `Model.full_clean()`, which `Model.save()` does **not** call, and `QuerySet.create()`/`update()`/`bulk_create()` do not call either. So `Model.objects.create(website=user_value)` skips the `URLField` scheme check, and a `CharField` where a `URLField` was meant never had one. ModelForm and ModelSerializer re-apply the model validators, so check the path the data takes.

Request-data containers: `request.POST`/`request.GET` are `QueryDict` (multi-valued; `.get()` returns the last value, `.dict()` flattens, `.getlist()` returns all). `request.body`/`json.loads` and DRF `request.data` can contain dicts, lists, numbers and `null` where a string was expected.

## Mass assignment in forms

Django's docs: it is "strongly recommended" to list `fields` explicitly; `'__all__'` and `exclude` are "much less secure and has led to serious exploits on major websites". New model fields silently become user-editable.

```python
class ProfileForm(forms.ModelForm):
    class Meta:
        model = Account
        fields = "__all__"                 # investigate: exposes is_staff, is_superuser, balance, owner...
        # exclude = ["password"]           # investigate: everything else is writable
```

Investigate:
- `fields = "__all__"` or `exclude = [...]` on models that hold privilege, ownership, billing, status, verification or tenant fields (`is_staff`, `is_superuser`, `is_active`, `role`, `owner`, `tenant`, `balance`, `email_verified`, `groups`, `user_permissions`).
- Forms bound to `instance=request.user` or `instance=get_object_or_404(Model, pk=pk)` without an ownership scope (also an IDOR, `authorization.md`).
- `exclude` removes fields from validation as well: Django does not validate excluded model fields.
- Hidden fields and `disabled=True`: hidden inputs are client-controlled; `disabled` ignores submitted values (safe).
- Formsets (`modelformset_factory`, `inlineformset_factory`) with `fields="__all__"`.

Fix: explicit `fields = [...]` allow-list, set privileged fields in the view (`obj = form.save(commit=False); obj.owner = request.user; obj.save()`), separate admin forms from user forms.

## Mass assignment in DRF serializers

```python
class AccountSerializer(serializers.ModelSerializer):
    class Meta:
        model = Account
        fields = "__all__"                  # or exclude = [...]; writable privilege fields, readable password hash
```

- `fields = "__all__"` or `exclude` on a user, account, order or tenant model: **High** when writable privilege fields exist (role/is_staff/owner/status) or sensitive fields are returned (password hash, tokens, MFA secrets, internal notes). It serves both mass assignment and data exposure (`api-security.md`).
- `read_only_fields` does not apply to fields that are declared explicitly on the serializer class; set `read_only=True` on the declared field. `extra_kwargs` is ignored for declared fields too (DRF docs). Fields with `editable=False` and AutoFields are read-only by default.
- A field readable by an attacker and in `ordering_fields`/`filterset_fields` is also an oracle (`api-security.md`).
- Writable nested serializers require explicit `create()`/`update()`; hand-written versions often pass nested dicts straight to the ORM (`User.objects.create(**validated_data)`), re-introducing mass assignment and password-in-plaintext bugs. `depth > 0` exposes related models' full field sets.
- Relation fields: `PrimaryKeyRelatedField(queryset=Model.objects.all())` lets clients reference other users' objects (`authorization.md` → foreign-key injection).
- Different serializers per action (`get_serializer_class`) is the safe pattern: input serializers for create/update, output serializers for read.
- `partial=True` PATCH on serializers with required-for-security fields (current password, ownership) bypasses "required".

Fix: explicit `fields`, `read_only_fields` for ownership/status/role, set owner in `perform_create(serializer): serializer.save(owner=self.request.user)`, and write passwords with `set_password` (or `validated_data.pop("password")` then `user.set_password`).

## Dict-splat into the ORM

```python
Model.objects.create(**request.POST.dict())     # mass assignment
Model.objects.filter(id=pk).update(**request.data)
setattr(obj, key, value) for key, value in request.data.items()
Model.objects.filter(**request.GET.dict())      # lookup/relation abuse (injection.md)
```

Each variant lets the client choose column names. For `filter()`/`exclude()`/`get()`/`Q(**d)` the keys also select lookups and relation traversal, and Django had SQL-injection CVEs for crafted dictionary expansion (see `injection.md`). Allow-list keys: `allowed = {"status", "priority"}; data = {k: v for k, v in request.GET.items() if k in allowed}`, or use a `Form`/`django-filter` `FilterSet` with an explicit `Meta.fields` list. `FilterSet` `Meta.exclude`, or fields declared for related lookups (`owner__password`), widen what clients can filter on.

## Type and shape confusion

- JSON values: a client can send an object or list where code expects a string. `str.lower()` on a list raises 500 (Low), but `filter(field__in=value)` or `Q(**value)` with attacker-shaped data can change query meaning. Validate through serializers/forms instead of `request.data[...]` directly.
- Booleans: `bool("false")` is `True`; compare against explicit strings or use `BooleanField`.
- Numbers: negative quantities, huge page sizes, float rounding on money (`DecimalField`), integer overflow into `PositiveIntegerField` (DB error, 500). Business-logic validation (price, quantity, discount, currency) must be server-side and use server prices, not submitted ones.
- Enumerations: validate against `choices`/`TextChoices` in the serializer or form, because direct ORM writes do not.
- Files: see `file-uploads.md`.

## Severity, false positives, verification

Severity: mass assignment of a privilege field with an authenticated or anonymous path to it is **Critical/High** (chain with admin or permission checks that trust the field). Password hash or secret exposure through `fields="__all__"` is **High**. Writable non-sensitive fields are Informational/Low.

False positives: `fields="__all__"` on a model with only harmless fields and no writable relations (note it as Hardening); `exclude` that removes every sensitive field and is accompanied by tests; serializers used for read-only output (`read_only=True` fields or `ReadOnlyModelViewSet`); `disabled=True` form fields.

Verify:

```python
def test_cannot_set_privileged_fields(client, django_user_model):
    u = django_user_model.objects.create_user("a", password="pw-a-123456")
    client.force_login(u)
    client.post("/accounts/profile/", {"company": "Acme", "is_staff": "on", "is_superuser": "on"})
    u.refresh_from_db()
    assert not u.is_staff and not u.is_superuser

def test_api_hides_password_hash(api_client, user):
    api_client.force_authenticate(user)
    assert "password" not in api_client.get(f"/api/accounts/{user.pk}/").json()
```

References: OWASP API3 Broken Object Property Level Authorization; CWE-915, CWE-20, CWE-213; https://docs.djangoproject.com/en/stable/topics/forms/modelforms/#selecting-the-fields-to-use, https://www.django-rest-framework.org/api-guide/serializers/#specifying-which-fields-to-include, https://django-filter.readthedocs.io/en/stable/ref/filterset.html.

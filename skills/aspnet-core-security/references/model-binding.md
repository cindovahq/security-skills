# ASP.NET Core — Model Binding, Validation and Overposting

## Contents
- How binding works
- What to investigate
- Fix patterns
- Severity, false positives, verification

## How binding works

- MVC and Razor Pages bind every public settable property of a complex parameter from route values, query, form or body (depending on `[ApiController]` inference and `[From*]` attributes). Razor Pages bind `PageModel` properties marked `[BindProperty]` (POST only unless `SupportsGet = true`) or the class marked `[BindProperties]`.
- `[ApiController]` infers `[FromBody]` for complex types, returns automatic 400 `ValidationProblemDetails` when `ModelState` is invalid, and infers `[FromForm]` for `IFormFile`.
- Minimal APIs bind complex types from the JSON body by default (415 for non-JSON content types), from `[AsParameters]`, or from forms with `[FromForm]`. Before .NET 10 minimal APIs did not run DataAnnotations validation; .NET 10 adds built-in validation when `builder.Services.AddValidation()` is called.
- `TryUpdateModelAsync(model)` binds **all** properties of `model` from the request; the overloads taking `params Expression<Func<TModel, object>>[] includeExpressions` restrict it.
- `[Bind("A,B")]` on an action parameter limits bound properties for create scenarios; it does not help with edits (unbound properties end up null/default and can overwrite data).
- Validation attributes (`[Required]`, `[StringLength]`, `[Range]`) run during binding; `ModelState.IsValid` must still be checked in non-`[ApiController]` controllers and Razor Pages.

## What to investigate

**1. EF entities bound directly (overposting / mass assignment).**
```csharp
[HttpPost] public async Task<IActionResult> Edit(Customer customer) { _db.Update(customer); await _db.SaveChangesAsync(); ... }
[BindProperty] public PortalUser Input { get; set; } = default!;
await TryUpdateModelAsync(user, "Input");                         // no include list
_db.Entry(existing).CurrentValues.SetValues(dto);                 // copies every matching property name
```
Attackers add form fields or JSON properties for `IsAdmin`, `Role`, `TenantId`/`CompanyId`, `OwnerId`, `Price`, `Balance`, `Status`, `EmailConfirmed`, `TwoFactorEnabled`, `LockoutEnd`, `PasswordHash`, or the primary key (`Id`), which with `_db.Update(entity)` can overwrite another user's row. Check entity classes for such properties before deciding severity.

**2. Mapping libraries.** AutoMapper/Mapster maps from a request DTO to an entity with matching property names (`CreateMap<UpdateUserRequest, User>()` where the DTO has `Role`), or `ReverseMap()` turning an output DTO into a writable input.

**3. JSON Patch.** `JsonPatchDocument<TEntity>` applied to an entity lets clients set any path (`/isAdmin`, `/ownerId`). Apply patches to a DTO, validate, then copy allowed fields. .NET 10 introduced the System.Text.Json-based `Microsoft.AspNetCore.JsonPatch.SystemTextJson` package; the same rule applies.

**4. Missing validation of business invariants.** Negative quantities, prices taken from the client, enum values not defined (`Enum.IsDefined`), dates in the past, collection sizes unbounded (`List<T>` with 100k items), `ModelState.IsValid` not checked before saving in MVC/Razor Pages.

**5. Type and binding surprises.** IDs bound from both route and body (`PUT /users/{id}` with a different `Id` in the body; code uses `body.Id`), `[FromQuery]` arrays used to widen filters, `[FromServices]` misuse is not an input but check `[FromHeader]` values used for identity (`X-User-Id`).

## Fix patterns

```csharp
public sealed record UpdateProfileRequest([Required, StringLength(80)] string DisplayName, [Phone] string? Phone);

[HttpPut("profile")]
public async Task<IActionResult> UpdateProfile(UpdateProfileRequest req)
{
    var user = await _userManager.GetUserAsync(User);
    if (user is null) return Unauthorized();
    user.DisplayName = req.DisplayName;
    user.PhoneNumber = req.Phone;
    await _userManager.UpdateAsync(user);
    return NoContent();
}

// Razor Pages edit with an include list
if (await TryUpdateModelAsync(user, "Input", u => u.DisplayName, u => u.PhoneNumber)) { await _db.SaveChangesAsync(); }
```

Set owner, tenant, status and price on the server. For `[ApiController]` APIs, reject unknown JSON members if strictness matters (`JsonSerializerOptions.UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow`, .NET 8+).

## Severity, false positives, verification

Severity: overposting a role, admin flag, tenant or owner field **Critical/High**; price/balance/status fields **High**; primary key overwrite enabling cross-user edits **High**; low-value fields **Low**.

False positives: entities bound where every sensitive property is `[BindNever]`, has no setter, or is overwritten server-side after binding (verify the assignment comes after binding and before save); DTOs that happen to share names with entity properties but are mapped field by field; `TryUpdateModelAsync` with include expressions.

Verify:
```csharp
[Fact]
public async Task Profile_update_ignores_privileged_fields()
{
    var client = _factory.CreateClientAs("alice");
    await client.PutAsJsonAsync("/api/account/profile", new { displayName = "A", isAdmin = true, companyId = 2 });
    using var scope = _factory.Services.CreateScope();
    var alice = await scope.ServiceProvider.GetRequiredService<PortalDbContext>().Users.SingleAsync(u => u.UserName == "alice");
    Assert.False(alice.IsAdmin); Assert.Equal(1, alice.CompanyId);
}
```

References: https://learn.microsoft.com/aspnet/core/mvc/models/model-binding, https://learn.microsoft.com/aspnet/core/data/ef-rp/crud#overposting, https://learn.microsoft.com/aspnet/core/web-api/jsonpatch, https://learn.microsoft.com/aspnet/core/fundamentals/minimal-apis/parameter-binding; OWASP Mass Assignment cheat sheet; OWASP API3:2023; CWE-915.

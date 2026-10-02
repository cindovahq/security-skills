# ASP.NET Core — Blazor Security

## Render modes and trust boundaries

Blazor Web App (.NET 8+) mixes render modes per component (`@rendermode`): static server-side rendering (SSR), `InteractiveServer` (components run on the server, UI events arrive over a SignalR circuit), `InteractiveWebAssembly` (components run in the browser) and `InteractiveAuto` (server first, then WebAssembly). Standalone Blazor WebAssembly and legacy Blazor Server apps follow the same rules.

- **Server-side code** (SSR, interactive server) can enforce authorization: `@attribute [Authorize]` on routable components, `AuthorizeRouteView`, policies, and explicit `IAuthorizationService` checks in event handlers.
- **WebAssembly code is public and modifiable.** Microsoft's docs: client-side authorization checks can be bypassed because all client-side code can be modified by users. Everything in the `.Client` project, its referenced assemblies and `wwwroot/appsettings*.json` is downloadable. For Auto/WebAssembly components, authorization must be enforced again by every server API the client calls.
- `AuthorizeView`, `<AuthorizeRouteView>` and hidden buttons only control what renders.

## What to investigate

1. **Secrets in the client:** connection strings, API keys, signing keys or private endpoints in `.Client` code, `wwwroot/appsettings.json` of a WebAssembly app, or `PersistentComponentState` payloads. Docs: never store secrets in client-side code.
2. **APIs behind WebAssembly components:** minimal APIs/controllers called by the client must have their own `[Authorize]`/policies and object-level checks (`authorization.md`); the component's `[Authorize]` attribute does not protect them.
3. **Interactive server event handlers:** an `[Authorize]` page whose handlers act on IDs taken from route parameters, query strings (`[SupplyParameterFromQuery]`), form models or JS interop arguments without checking ownership. Treat each handler like a controller action. Re-check authorization for privileged actions, because circuit-held authentication state can lag behind role changes (`RevalidatingServerAuthenticationStateProvider` revalidates periodically, 30 minutes in the template).
4. **Raw HTML and JS interop:** `(MarkupString)userValue`, `IJSRuntime.InvokeAsync("eval", ...)`, custom JS writing `innerHTML` with values passed from .NET (`xss.md`).
5. **Forms and antiforgery:** SSR forms (`EditForm` with `FormName`, `[SupplyParameterFromForm]`) rely on `UseAntiforgery()` (present in the template) and the `AntiforgeryToken` component that `EditForm` adds; check for `[RequireAntiforgeryToken(required: false)]` on components and removal of `UseAntiforgery()` in apps that are not on .NET 11's automatic CSRF protection (`csrf.md`). Overposting applies to `[SupplyParameterFromForm]` models bound to entities (`model-binding.md`).
6. **Circuit and state exposure:** user-specific data in singleton services (shared across all circuits and users), static fields caching per-user state, scoped services assumed to be per request (they are per circuit in interactive server).
7. **Error detail:** `CircuitOptions.DetailedErrors = true` or `DetailedErrors` configuration outside development sends exception details to the browser.
8. **Prerendering:** components that load sensitive data in `OnInitializedAsync` during prerender with a custom `AuthenticationStateProvider` can render it before authentication state is resolved; Microsoft documents approaches such as disabling prerendering for such components.

## Fix pattern

```razor
@page "/tickets/{Id:int}"
@attribute [Authorize]
@inject IAuthorizationService Authz
@inject TicketService Tickets

@code {
    [Parameter] public int Id { get; set; }
    [CascadingParameter] private Task<AuthenticationState> AuthState { get; set; } = default!;

    private async Task CloseAsync()
    {
        var user = (await AuthState).User;
        var ticket = await Tickets.GetAsync(Id);
        if (ticket is null || !(await Authz.AuthorizeAsync(user, ticket, "TicketOwner")).Succeeded) return;
        await Tickets.CloseAsync(ticket);
    }
}
```

## Severity, false positives, verification

Severity: secrets shipped in WebAssembly assets **High/Critical** (by what the secret unlocks); server APIs trusting WebAssembly-side checks **High**; event-handler IDOR in interactive server components **High**; singleton holding per-user data **High** (cross-user exposure); detailed circuit errors **Low/Medium**.

False positives: `AuthorizeView` used for display while the server enforces access; public configuration (API base URL, public client IDs) in client `appsettings.json`; `[Authorize]` on a WebAssembly component when the data comes from authorized APIs.

Verify: inspect the published `wwwroot/_framework` and `appsettings*.json` of the client for secrets; call the backing APIs directly with a second user's token in `WebApplicationFactory` tests (`verification.md`); for interactive server components, use bUnit or an integration test that invokes the service method the handler uses with another user's principal.

References: https://learn.microsoft.com/aspnet/core/blazor/security/, https://learn.microsoft.com/aspnet/core/blazor/security/webassembly/, https://learn.microsoft.com/aspnet/core/blazor/components/render-modes, https://learn.microsoft.com/aspnet/core/blazor/security/interactive-server-side-rendering; OWASP Authorization cheat sheet; CWE-602, CWE-639, CWE-79.

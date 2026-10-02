using Acme.Portal.Models;
using Acme.Portal.Services;
using Microsoft.AspNetCore.Identity;

namespace Acme.Portal.Endpoints;

public static class TokenEndpoints
{
    public static void MapTokenEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/token", async (
            TokenRequest request,
            UserManager<PortalUser> users,
            SignInManager<PortalUser> signIn,
            TokenService tokens) =>
        {
            var user = await users.FindByEmailAsync(request.Email);
            if (user is null)
            {
                return Results.Unauthorized();
            }

            var result = await signIn.CheckPasswordSignInAsync(user, request.Password, lockoutOnFailure: false);
            if (!result.Succeeded)
            {
                return Results.Unauthorized();
            }

            return Results.Ok(new { access_token = await tokens.CreateAsync(user), token_type = "Bearer" });
        })
        .AllowAnonymous();
    }
}

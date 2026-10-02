using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Acme.Portal.Data;
using Acme.Portal.Models;
using Acme.Portal.Services;
using Microsoft.EntityFrameworkCore;

namespace Acme.Portal.Endpoints;

public static class IntegrationEndpoints
{
    private static readonly HashSet<string> SupportedCurrencies = ["USD", "EUR", "GBP", "INR", "JPY"];

    public static void MapIntegrationEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/integrations/link-preview", async (string url, IHttpClientFactory factory) =>
        {
            var client = factory.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(10);

            var html = await client.GetStringAsync(url);
            var title = Regex.Match(html, "<title>(.*?)</title>", RegexOptions.IgnoreCase | RegexOptions.Singleline)
                .Groups[1].Value.Trim();

            return Results.Ok(new
            {
                url,
                title,
                snippet = html.Length > 500 ? html[..500] : html
            });
        })
        .RequireAuthorization();

        app.MapGet("/integrations/fx-rates/{currency}", async (string currency, IHttpClientFactory factory) =>
        {
            var code = currency.ToUpperInvariant();
            if (!SupportedCurrencies.Contains(code))
            {
                return Results.BadRequest();
            }

            var client = factory.CreateClient("fx");
            var rates = await client.GetFromJsonAsync<FxRates>($"latest?base={code}");
            return Results.Ok(rates);
        })
        .RequireAuthorization();

        app.MapPost("/webhooks/payments", async (PaymentEvent evt, PortalDbContext db, ILoggerFactory loggers) =>
        {
            if (evt.Type != "payment.succeeded")
            {
                return Results.Ok();
            }

            var invoice = await db.Invoices.SingleOrDefaultAsync(i => i.Number == evt.InvoiceNumber);
            if (invoice is null)
            {
                return Results.NotFound();
            }

            invoice.Status = "Paid";
            invoice.PaidOn = DateTime.UtcNow;
            invoice.PaymentReference = evt.PaymentId;
            await db.SaveChangesAsync();

            loggers.CreateLogger("Payments").LogInformation("Invoice {Number} marked paid ({PaymentId})", invoice.Number, evt.PaymentId);
            return Results.Ok();
        })
        .AllowAnonymous();

        app.MapPost("/webhooks/docs-sync", async (HttpRequest request, IConfiguration configuration, DocsSyncQueue queue) =>
        {
            using var buffer = new MemoryStream();
            await request.Body.CopyToAsync(buffer);
            var body = buffer.ToArray();

            var secret = Encoding.UTF8.GetBytes(configuration["Integrations:DocsWebhookSecret"]!);
            var expected = HMACSHA256.HashData(secret, body);

            var header = request.Headers["X-Hub-Signature-256"].ToString();
            if (!header.StartsWith("sha256=", StringComparison.Ordinal))
            {
                return Results.Unauthorized();
            }

            byte[] provided;
            try
            {
                provided = Convert.FromHexString(header["sha256=".Length..]);
            }
            catch (FormatException)
            {
                return Results.Unauthorized();
            }

            if (!CryptographicOperations.FixedTimeEquals(expected, provided))
            {
                return Results.Unauthorized();
            }

            return queue.TryEnqueue(body) ? Results.Accepted() : Results.StatusCode(StatusCodes.Status503ServiceUnavailable);
        })
        .AllowAnonymous();
    }

    public static void MapDeviceEndpoints(this IEndpointRouteBuilder app)
    {
        var devices = app.MapGroup("/api/v1/devices")
            .RequireAuthorization("ApiClients")
            .DisableAntiforgery();

        devices.MapPost("/{deviceId:guid}/logs", async (
            Guid deviceId,
            IFormFile file,
            ClaimsPrincipal principal,
            PortalDbContext db,
            IConfiguration configuration) =>
        {
            var clientId = principal.FindFirstValue("client_id");
            var device = await db.Devices.SingleOrDefaultAsync(d => d.Id == deviceId && d.ClientId == clientId);
            if (device is null)
            {
                return Results.NotFound();
            }

            if (file.Length is 0 or > 10_000_000)
            {
                return Results.BadRequest();
            }

            var folder = Path.Combine(configuration["Storage:DeviceLogRoot"]!, device.Id.ToString("N"));
            Directory.CreateDirectory(folder);
            var stored = Path.Combine(folder, Path.GetRandomFileName() + ".log");

            await using (var output = new FileStream(stored, FileMode.CreateNew))
            {
                await file.CopyToAsync(output);
            }

            return Results.Accepted();
        });
    }
}

using System.Diagnostics;
using System.Linq.Dynamic.Core;
using System.Security.Claims;
using Acme.Portal.Data;
using Acme.Portal.Models;
using Dapper;
using Microsoft.AspNetCore.Identity;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Acme.Portal.Endpoints;

public static class ReportEndpoints
{
    public static void MapReportEndpoints(this IEndpointRouteBuilder app)
    {
        var reports = app.MapGroup("/reports").RequireAuthorization();

        reports.MapGet("/orders", async (
            string? status,
            ClaimsPrincipal principal,
            UserManager<PortalUser> users,
            IConfiguration configuration) =>
        {
            var me = await users.GetUserAsync(principal);

            var sql = $"SELECT Id, Number, Status, Total, CreatedOn FROM Orders WHERE CompanyId = {me!.CompanyId}";
            if (!string.IsNullOrWhiteSpace(status))
            {
                sql += $" AND Status = '{status}'";
            }

            await using var connection = new SqlConnection(configuration.GetConnectionString("Portal"));
            var rows = await connection.QueryAsync<OrderSummary>(sql + " ORDER BY CreatedOn DESC");
            return Results.Ok(rows);
        });

        reports.MapGet("/tickets", async (
            string? filter,
            string? sort,
            ClaimsPrincipal principal,
            UserManager<PortalUser> users,
            PortalDbContext db) =>
        {
            var me = await users.GetUserAsync(principal);
            IQueryable<Ticket> query = db.Tickets.Where(t => t.CompanyId == me!.CompanyId);

            if (!string.IsNullOrWhiteSpace(filter))
            {
                query = query.Where(filter);
            }

            query = query.OrderBy(string.IsNullOrWhiteSpace(sort) ? "CreatedOn desc" : sort);

            var rows = await query
                .Select(t => new { t.Id, t.Subject, t.Status, t.Priority, t.CreatedOn })
                .ToListAsync();
            return Results.Ok(rows);
        });

        reports.MapPost("/export", async (
            ExportRequest request,
            ClaimsPrincipal principal,
            UserManager<PortalUser> users) =>
        {
            var me = await users.GetUserAsync(principal);

            var startInfo = new ProcessStartInfo("/bin/sh") { RedirectStandardError = true };
            startInfo.ArgumentList.Add("-c");
            startInfo.ArgumentList.Add(
                $"tar -czf /var/acme/exports/{request.ArchiveName}.tar.gz -C /var/acme/data company-{me!.CompanyId}");

            using var process = Process.Start(startInfo)!;
            await process.WaitForExitAsync();

            return process.ExitCode == 0
                ? Results.Ok(new { file = $"{request.ArchiveName}.tar.gz" })
                : Results.Problem("Export failed.");
        });

        reports.MapGet("/documents/{id:int}/thumbnail", async (
            int id,
            ClaimsPrincipal principal,
            UserManager<PortalUser> users,
            PortalDbContext db,
            IConfiguration configuration) =>
        {
            var me = await users.GetUserAsync(principal);
            var document = await db.Documents.SingleOrDefaultAsync(d => d.Id == id && d.CompanyId == me!.CompanyId);
            if (document is null)
            {
                return Results.NotFound();
            }

            var root = configuration["Storage:DocumentRoot"]!;
            var source = Path.Combine(root, document.StoredFileName);
            var target = Path.Combine(Path.GetTempPath(), $"thumb-{document.Id}.png");

            var startInfo = new ProcessStartInfo("/usr/bin/convert");
            startInfo.ArgumentList.Add(source + "[0]");
            startInfo.ArgumentList.Add("-thumbnail");
            startInfo.ArgumentList.Add("240x240");
            startInfo.ArgumentList.Add(target);

            using var process = Process.Start(startInfo)!;
            await process.WaitForExitAsync();

            return process.ExitCode == 0
                ? Results.File(await File.ReadAllBytesAsync(target), "image/png")
                : Results.Problem("Thumbnail generation failed.");
        });
    }
}

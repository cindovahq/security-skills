using System.Text;
using Acme.Portal.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Acme.Portal.Controllers;

[Authorize(Roles = "Admin")]
[Route("admin")]
public class AdminController(PortalDbContext db) : Controller
{
    [HttpGet("")]
    public async Task<IActionResult> Index()
    {
        ViewData["UserCount"] = await db.Users.CountAsync();
        ViewData["OpenTickets"] = await db.Tickets.CountAsync(t => t.Status == "Open");
        return View();
    }

    [HttpGet("users/export")]
    [AllowAnonymous]
    public async Task<IActionResult> ExportUsers()
    {
        var users = await db.Users.AsNoTracking().OrderBy(u => u.Email).ToListAsync();

        var csv = new StringBuilder("Id,Email,DisplayName,CompanyId,PhoneNumber,JobTitle,IsCompanyAdmin\n");
        foreach (var u in users)
        {
            csv.AppendLine($"{u.Id},{u.Email},{u.DisplayName},{u.CompanyId},{u.PhoneNumber},{u.JobTitle},{u.IsCompanyAdmin}");
        }

        return File(Encoding.UTF8.GetBytes(csv.ToString()), "text/csv", "users.csv");
    }
}

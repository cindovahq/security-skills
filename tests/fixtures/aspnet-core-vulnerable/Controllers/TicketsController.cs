using Acme.Portal.Data;
using Acme.Portal.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Acme.Portal.Controllers;

[Authorize]
public class TicketsController(PortalDbContext db, UserManager<PortalUser> userManager) : Controller
{
    public async Task<IActionResult> Index()
    {
        var user = await userManager.GetUserAsync(User);
        var tickets = await db.Tickets
            .Where(t => t.CompanyId == user!.CompanyId)
            .OrderByDescending(t => t.CreatedOn)
            .ToListAsync();
        return View(tickets);
    }

    public async Task<IActionResult> Search(string q)
    {
        var user = await userManager.GetUserAsync(User);
        var tickets = await db.Tickets
            .FromSqlRaw($"SELECT * FROM Tickets WHERE CompanyId = {user!.CompanyId} AND Subject LIKE '%{q}%'")
            .OrderByDescending(t => t.CreatedOn)
            .ToListAsync();
        return View("Index", tickets);
    }

    public async Task<IActionResult> Details(int id)
    {
        var user = await userManager.GetUserAsync(User);
        var ticket = await db.Tickets
            .FromSql($"SELECT * FROM Tickets WHERE Id = {id} AND CompanyId = {user!.CompanyId}")
            .Include(t => t.Comments)
            .SingleOrDefaultAsync();

        if (ticket is null)
        {
            return NotFound();
        }

        var meta = new TicketMeta(ticket.Id, ticket.Status, ticket.Priority, ticket.CreatedByName);
        return View(new TicketDetailsViewModel(ticket, meta));
    }

    [Authorize(Roles = "Support")]
    public async Task<IActionResult> Queue(string status = "Open")
    {
        var tickets = await db.Tickets
            .FromSqlRaw("SELECT * FROM Tickets WHERE Status = {0}", status)
            .OrderBy(t => t.CreatedOn)
            .ToListAsync();
        return View("Index", tickets);
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Create(TicketInput input)
    {
        if (!ModelState.IsValid)
        {
            return BadRequest(ModelState);
        }

        var user = await userManager.GetUserAsync(User);
        var ticket = new Ticket
        {
            CompanyId = user!.CompanyId,
            CreatedById = user.Id,
            CreatedByName = user.DisplayName,
            Subject = input.Subject,
            Description = input.Description,
            CreatedOn = DateTime.UtcNow
        };
        db.Tickets.Add(ticket);
        await db.SaveChangesAsync();
        return RedirectToAction(nameof(Details), new { id = ticket.Id });
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> AddComment(int id, string body)
    {
        var user = await userManager.GetUserAsync(User);
        var ticket = await db.Tickets.SingleOrDefaultAsync(t => t.Id == id && t.CompanyId == user!.CompanyId);
        if (ticket is null)
        {
            return NotFound();
        }

        db.TicketComments.Add(new TicketComment
        {
            TicketId = ticket.Id,
            AuthorName = user!.DisplayName,
            Body = body,
            CreatedOn = DateTime.UtcNow
        });
        await db.SaveChangesAsync();
        return RedirectToAction(nameof(Details), new { id });
    }
}

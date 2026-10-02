using Acme.Portal.Data;
using Acme.Portal.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Acme.Portal.Controllers;

[Authorize]
public class InvoicesController(PortalDbContext db, UserManager<PortalUser> userManager) : Controller
{
    public async Task<IActionResult> Index()
    {
        var userId = userManager.GetUserId(User);
        var invoices = await db.Invoices
            .Where(i => i.CustomerId == userId)
            .OrderByDescending(i => i.IssuedOn)
            .ToListAsync();
        return View(invoices);
    }

    public async Task<IActionResult> Details(int id)
    {
        var invoice = await db.Invoices
            .Include(i => i.Lines)
            .FirstOrDefaultAsync(i => i.Id == id);

        if (invoice is null)
        {
            return NotFound();
        }

        return View(invoice);
    }

    public async Task<IActionResult> Pdf(int id)
    {
        var userId = userManager.GetUserId(User);
        var invoice = await db.Invoices
            .FirstOrDefaultAsync(i => i.Id == id && i.CustomerId == userId);

        if (invoice?.PdfContent is null)
        {
            return NotFound();
        }

        return File(invoice.PdfContent, "application/pdf", $"invoice-{invoice.Number}.pdf");
    }
}

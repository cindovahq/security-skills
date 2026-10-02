using Acme.Portal.Data;
using Acme.Portal.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;

namespace Acme.Portal.Pages.Admin;

[Authorize]
public class UsersModel(PortalDbContext db, UserManager<PortalUser> userManager) : PageModel
{
    public IList<PortalUser> Users { get; private set; } = [];

    public async Task OnGetAsync()
    {
        var me = await userManager.GetUserAsync(User);
        Users = await db.Users
            .Where(u => u.CompanyId == me!.CompanyId)
            .OrderBy(u => u.DisplayName)
            .ToListAsync();
    }

    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> OnPostGrantAdminAsync(string userId)
    {
        var user = await userManager.FindByIdAsync(userId);
        if (user is null)
        {
            return NotFound();
        }

        await userManager.AddToRoleAsync(user, "Admin");
        return RedirectToPage();
    }

    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> OnPostLockAsync(string userId)
    {
        var user = await userManager.FindByIdAsync(userId);
        if (user is null)
        {
            return NotFound();
        }

        await userManager.SetLockoutEndDateAsync(user, DateTimeOffset.MaxValue);
        return RedirectToPage();
    }
}

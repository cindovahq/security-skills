using Acme.Portal.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace Acme.Portal.Pages;

[Authorize]
public class ProfileModel(UserManager<PortalUser> userManager) : PageModel
{
    [BindProperty]
    public PortalUser Input { get; set; } = new();

    [TempData]
    public string? StatusMessage { get; set; }

    public async Task<IActionResult> OnGetAsync()
    {
        var user = await userManager.GetUserAsync(User);
        if (user is null)
        {
            return Challenge();
        }

        Input = user;
        return Page();
    }

    public async Task<IActionResult> OnPostAsync()
    {
        var user = await userManager.GetUserAsync(User);
        if (user is null)
        {
            return Challenge();
        }

        if (!await TryUpdateModelAsync(user, "Input"))
        {
            return Page();
        }

        await userManager.UpdateAsync(user);
        StatusMessage = "Your profile has been saved.";
        return RedirectToPage();
    }
}

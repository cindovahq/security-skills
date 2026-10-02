using Acme.Portal.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;

namespace Acme.Portal.Controllers;

public class AccountController(
    SignInManager<PortalUser> signInManager,
    UserManager<PortalUser> userManager,
    ILogger<AccountController> logger) : Controller
{
    [HttpGet]
    [AllowAnonymous]
    public IActionResult Login(string? returnUrl = null) =>
        View(new LoginViewModel { ReturnUrl = returnUrl });

    [HttpPost]
    [AllowAnonymous]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Login(LoginViewModel model)
    {
        if (!ModelState.IsValid)
        {
            return View(model);
        }

        var result = await signInManager.PasswordSignInAsync(
            model.Email, model.Password, model.RememberMe, lockoutOnFailure: false);

        if (!result.Succeeded)
        {
            logger.LogWarning("Failed sign-in for {Email}", model.Email);
            ModelState.AddModelError(string.Empty, "Invalid login attempt.");
            return View(model);
        }

        if (!string.IsNullOrEmpty(model.ReturnUrl))
        {
            return Redirect(model.ReturnUrl);
        }

        return RedirectToAction("Index", "Invoices");
    }

    [HttpGet]
    public async Task<IActionResult> Manage()
    {
        var user = await userManager.GetUserAsync(User);
        return user is null ? Challenge() : View(user);
    }

    [HttpPost]
    public async Task<IActionResult> ChangeEmail(string newEmail)
    {
        var user = await userManager.GetUserAsync(User);
        if (user is null)
        {
            return Challenge();
        }

        await userManager.SetEmailAsync(user, newEmail);
        await userManager.SetUserNameAsync(user, newEmail);
        await signInManager.RefreshSignInAsync(user);

        TempData["Status"] = "Your email address has been updated.";
        return RedirectToAction(nameof(Manage));
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Logout(string? returnUrl = null)
    {
        await signInManager.SignOutAsync();
        return LocalRedirect(returnUrl ?? "/");
    }
}

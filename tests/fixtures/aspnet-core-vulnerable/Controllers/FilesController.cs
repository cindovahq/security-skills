using Acme.Portal.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;

namespace Acme.Portal.Controllers;

[Authorize]
[Route("files")]
public class FilesController(
    IWebHostEnvironment env,
    IConfiguration configuration,
    UserManager<PortalUser> userManager) : Controller
{
    private readonly string _exportRoot = configuration["Storage:ExportRoot"]!;

    [HttpGet("download")]
    public IActionResult Download(string name)
    {
        var path = Path.Combine(_exportRoot, name);
        if (!System.IO.File.Exists(path))
        {
            return NotFound();
        }

        return PhysicalFile(path, "application/octet-stream", Path.GetFileName(path));
    }

    [HttpPost("avatar")]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> UploadAvatar(IFormFile file)
    {
        if (file.Length == 0 || file.Length > 2_000_000)
        {
            return BadRequest("Avatar must be between 1 byte and 2 MB.");
        }

        var folder = Path.Combine(env.WebRootPath, "uploads", "avatars");
        Directory.CreateDirectory(folder);

        var path = Path.Combine(folder, file.FileName);
        await using (var stream = System.IO.File.Create(path))
        {
            await file.CopyToAsync(stream);
        }

        var user = await userManager.GetUserAsync(User);
        user!.AvatarPath = $"/uploads/avatars/{file.FileName}";
        await userManager.UpdateAsync(user);

        return RedirectToPage("/Profile");
    }
}

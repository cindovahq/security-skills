using Microsoft.AspNetCore.Identity;

namespace Acme.Portal.Models;

public class PortalUser : IdentityUser
{
    public string DisplayName { get; set; } = string.Empty;
    public int CompanyId { get; set; }
    public bool IsCompanyAdmin { get; set; }
    public string? JobTitle { get; set; }
    public string? AvatarPath { get; set; }
}

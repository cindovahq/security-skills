using System.Security.Claims;
using System.Xml.Linq;
using Acme.Portal.Data;
using Acme.Portal.Models;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Newtonsoft.Json;

namespace Acme.Portal.Controllers.Api;

[ApiController]
[Route("api/imports")]
[Authorize(AuthenticationSchemes = JwtBearerDefaults.AuthenticationScheme)]
public class ImportController(PortalDbContext db, ILogger<ImportController> logger) : ControllerBase
{
    private static readonly JsonSerializerSettings ImportSettings = new()
    {
        TypeNameHandling = TypeNameHandling.All,
        MissingMemberHandling = MissingMemberHandling.Ignore
    };

    [HttpPost("orders")]
    public async Task<IActionResult> ImportOrders()
    {
        using var reader = new StreamReader(Request.Body);
        var body = await reader.ReadToEndAsync();

        var batch = JsonConvert.DeserializeObject<ImportBatch>(body, ImportSettings);
        if (batch is null)
        {
            return BadRequest();
        }

        var companyId = int.Parse(User.FindFirstValue("company_id")!);
        var orders = batch.Items.OfType<Order>().ToList();
        foreach (var order in orders)
        {
            order.Id = 0;
            order.CompanyId = companyId;
        }

        db.Orders.AddRange(orders);
        await db.SaveChangesAsync();
        logger.LogInformation("Imported {Count} orders from {Source}", orders.Count, batch.Source);
        return Ok(new { imported = orders.Count });
    }

    [HttpPost("catalog")]
    public async Task<IActionResult> ImportCatalog(IFormFile file)
    {
        var companyId = int.Parse(User.FindFirstValue("company_id")!);

        await using var stream = file.OpenReadStream();
        var document = XDocument.Load(stream);

        var items = document.Root!
            .Elements("item")
            .Select(e => new CatalogItem
            {
                CompanyId = companyId,
                Sku = (string?)e.Attribute("sku") ?? string.Empty,
                Name = (string?)e.Element("name") ?? string.Empty
            })
            .ToList();

        db.CatalogItems.AddRange(items);
        await db.SaveChangesAsync();
        return Ok(new { imported = items.Count });
    }
}

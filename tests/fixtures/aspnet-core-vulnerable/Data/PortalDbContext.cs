using Acme.Portal.Models;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace Acme.Portal.Data;

public class PortalDbContext(DbContextOptions<PortalDbContext> options) : IdentityDbContext<PortalUser>(options)
{
    public DbSet<Invoice> Invoices => Set<Invoice>();
    public DbSet<InvoiceLine> InvoiceLines => Set<InvoiceLine>();
    public DbSet<Ticket> Tickets => Set<Ticket>();
    public DbSet<TicketComment> TicketComments => Set<TicketComment>();
    public DbSet<Order> Orders => Set<Order>();
    public DbSet<Device> Devices => Set<Device>();
    public DbSet<Document> Documents => Set<Document>();
    public DbSet<CatalogItem> CatalogItems => Set<CatalogItem>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);
        builder.Entity<Invoice>().Property(i => i.Total).HasPrecision(18, 2);
        builder.Entity<InvoiceLine>().Property(l => l.UnitPrice).HasPrecision(18, 2);
        builder.Entity<Order>().Property(o => o.Total).HasPrecision(18, 2);
        builder.Entity<Invoice>().HasIndex(i => i.Number).IsUnique();
    }
}

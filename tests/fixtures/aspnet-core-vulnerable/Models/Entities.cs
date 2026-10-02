namespace Acme.Portal.Models;

public class Invoice
{
    public int Id { get; set; }
    public string Number { get; set; } = string.Empty;
    public string CustomerId { get; set; } = string.Empty;
    public int CompanyId { get; set; }
    public decimal Total { get; set; }
    public string Status { get; set; } = "Open";
    public DateTime IssuedOn { get; set; }
    public DateTime? PaidOn { get; set; }
    public string? PaymentReference { get; set; }
    public string BillingAddress { get; set; } = string.Empty;
    public byte[]? PdfContent { get; set; }
    public List<InvoiceLine> Lines { get; set; } = [];
}

public class InvoiceLine
{
    public int Id { get; set; }
    public int InvoiceId { get; set; }
    public string Description { get; set; } = string.Empty;
    public int Quantity { get; set; }
    public decimal UnitPrice { get; set; }
}

public class Ticket
{
    public int Id { get; set; }
    public int CompanyId { get; set; }
    public string CreatedById { get; set; } = string.Empty;
    public string CreatedByName { get; set; } = string.Empty;
    public string Subject { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string Status { get; set; } = "Open";
    public string Priority { get; set; } = "Normal";
    public DateTime CreatedOn { get; set; }
    public List<TicketComment> Comments { get; set; } = [];
}

public class TicketComment
{
    public int Id { get; set; }
    public int TicketId { get; set; }
    public string AuthorName { get; set; } = string.Empty;
    public string Body { get; set; } = string.Empty;
    public DateTime CreatedOn { get; set; }
}

public class Order
{
    public int Id { get; set; }
    public int CompanyId { get; set; }
    public string Number { get; set; } = string.Empty;
    public string Status { get; set; } = "Pending";
    public decimal Total { get; set; }
    public DateTime CreatedOn { get; set; }
}

public class Device
{
    public Guid Id { get; set; }
    public string ClientId { get; set; } = string.Empty;
    public int CompanyId { get; set; }
    public string Name { get; set; } = string.Empty;
}

public class Document
{
    public int Id { get; set; }
    public int CompanyId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string StoredFileName { get; set; } = string.Empty;
}

public class CatalogItem
{
    public int Id { get; set; }
    public int CompanyId { get; set; }
    public string Sku { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
}

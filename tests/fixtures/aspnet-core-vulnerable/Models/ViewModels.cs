using System.ComponentModel.DataAnnotations;

namespace Acme.Portal.Models;

public class LoginViewModel
{
    [Required, EmailAddress]
    public string Email { get; set; } = string.Empty;

    [Required, DataType(DataType.Password)]
    public string Password { get; set; } = string.Empty;

    public bool RememberMe { get; set; }

    public string? ReturnUrl { get; set; }
}

public record TicketInput(
    [property: Required, StringLength(200)] string Subject,
    [property: Required, StringLength(20000)] string Description);

public record TicketMeta(int Id, string Status, string Priority, string CreatedByName);

public record TicketDetailsViewModel(Ticket Ticket, TicketMeta Meta);

public record OrderSummary(int Id, string Number, string Status, decimal Total, DateTime CreatedOn);

public record ExportRequest(string ArchiveName);

public record TokenRequest(string Email, string Password);

public record PaymentEvent(string Type, string PaymentId, string InvoiceNumber, decimal Amount);

public record FxRates(string Base, Dictionary<string, decimal> Rates);

public class ImportBatch
{
    public string Source { get; set; } = string.Empty;
    public DateTime GeneratedOn { get; set; }
    public List<object> Items { get; set; } = [];
}

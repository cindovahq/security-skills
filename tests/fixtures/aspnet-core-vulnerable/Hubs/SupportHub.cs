using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace Acme.Portal.Hubs;

[Authorize]
public class SupportHub : Hub
{
    public Task JoinTicket(int ticketId) =>
        Groups.AddToGroupAsync(Context.ConnectionId, $"ticket-{ticketId}");

    public Task LeaveTicket(int ticketId) =>
        Groups.RemoveFromGroupAsync(Context.ConnectionId, $"ticket-{ticketId}");

    public async Task SendMessage(int ticketId, string message)
    {
        var author = Context.User?.Identity?.Name ?? "unknown";
        await Clients.Group($"ticket-{ticketId}").SendAsync("message", author, message, DateTime.UtcNow);
    }
}

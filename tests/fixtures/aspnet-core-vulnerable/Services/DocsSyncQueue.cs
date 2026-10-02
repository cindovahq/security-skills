using System.Threading.Channels;

namespace Acme.Portal.Services;

public class DocsSyncQueue
{
    private readonly Channel<byte[]> _channel = Channel.CreateBounded<byte[]>(100);

    public bool TryEnqueue(byte[] payload) => _channel.Writer.TryWrite(payload);

    public IAsyncEnumerable<byte[]> ReadAllAsync(CancellationToken cancellationToken) =>
        _channel.Reader.ReadAllAsync(cancellationToken);
}

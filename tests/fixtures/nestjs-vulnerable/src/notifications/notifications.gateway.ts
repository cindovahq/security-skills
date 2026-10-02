import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Public } from '../common/public.decorator';

@Public()
@WebSocketGateway({ cors: { origin: '*' } })
export class NotificationsGateway implements OnGatewayConnection {
  @WebSocketServer()
  server: Server;

  handleConnection(client: Socket) {
    const userId = client.handshake.query.userId as string | undefined;
    if (!userId) {
      client.disconnect();
      return;
    }
    client.data.userId = userId;
    client.join(`user:${userId}`);
  }

  @SubscribeMessage('subscribe')
  subscribe(@ConnectedSocket() client: Socket, @MessageBody() body: { room: string }) {
    client.join(body.room);
    return { event: 'subscribed', data: body.room };
  }

  notifyUser(userId: string, event: string, payload: unknown) {
    this.server.to(`user:${userId}`).emit(event, payload);
  }
}

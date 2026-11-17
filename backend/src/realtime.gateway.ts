
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';

import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
    credentials: true,
  },
  transports: ['websocket', 'polling'],
})
export class DeskGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  afterInit() {
    console.log('DeskSync WebSocket Gateway initialized');
  }

  handleConnection(client: Socket) {
    console.log(`WebSocket connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`WebSocket disconnected: ${client.id}`);
  }

  emitChange(event: string, data: any = {}) {
    this.server?.emit(event, data);
  }
}

import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';
import type { BoardSnapshot } from '../board/board.service';

export type BoardSnapshotRestoredPayload = {
  roomId: string;
  version: number;
  restoredFromVersion: number;
  actorId: string;
  snapshot: BoardSnapshot;
  serverTime: string;
};

@Injectable()
export class RealtimeRoomEventsService {
  private server: Server | null = null;

  attachServer(server: Server): void {
    this.server = server;
  }

  publishSnapshotRestored(payload: BoardSnapshotRestoredPayload): void {
    this.server?.to(this.getRoomChannel(payload.roomId)).emit('board:snapshot:restored', payload);
  }

  private getRoomChannel(roomId: string): string {
    return `room:${roomId}`;
  }
}

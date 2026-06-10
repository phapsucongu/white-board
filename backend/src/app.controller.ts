import { Controller, Get } from '@nestjs/common';
import type { BoardEvent, ServiceHealth, SocketEventName } from '@whiteboard/shared';

const healthEventName: SocketEventName = 'room:joined';
const sampleEventVersion: BoardEvent['version'] = 0;

@Controller()
export class AppController {
  @Get('health')
  getHealth(): ServiceHealth {
    void healthEventName;
    void sampleEventVersion;

    return {
      status: 'ok'
    };
  }
}

export type ServiceHealth = {
  status: 'ok';
};

export type UserId = string;

export type RoomId = string;

export type BoardObjectId = string;

export type RoomRole = 'owner' | 'editor' | 'viewer';

export type BoardObjectType = 'rectangle' | 'circle' | 'line' | 'text';

export type BoardObject = {
  id: BoardObjectId;
  roomId: RoomId;
  type: BoardObjectType;
  x: number;
  y: number;
  rotation?: number;
  version: number;
  createdBy: UserId;
  updatedBy: UserId;
  createdAt: string;
  updatedAt: string;
  deleted?: boolean;
  props: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type BoardEvent = {
  id: string;
  roomId: RoomId;
  version: number;
  actorId: UserId;
  objectId?: BoardObjectId;
  eventName: SocketEventName;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type SocketEventName =
  | 'room:join'
  | 'room:leave'
  | 'room:joined'
  | 'presence:update'
  | 'presence:changed'
  | 'shape:preview'
  | 'board:op'
  | 'board:ack'
  | 'board:events'
  | 'history:undo'
  | 'history:redo'
  | 'text:lease:start'
  | 'text:lease:end'
  | 'text:lease:granted'
  | 'text:lease:busy'
  | 'room:error';

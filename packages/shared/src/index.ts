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
  | 'room:joined'
  | 'presence:update'
  | 'cursor:update'
  | 'cursor:broadcast'
  | 'cursor:remove'
  | 'selection:update'
  | 'selection:broadcast'
  | 'selection:remove'
  | 'shape:preview'
  | 'board:event'
  | 'board:event:accepted'
  | 'board:event:broadcast'
  | 'board:event:rejected'
  | 'board:snapshot:restored'
  | 'text:lease:claim'
  | 'text:lease:release'
  | 'text:lease:denied'
  | 'text:lease:update'
  | 'text:yjs:update'
  | 'text:yjs:accepted'
  | 'text:yjs:broadcast'
  | 'room:error';

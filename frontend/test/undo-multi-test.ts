/**
 * Test: Multiple operations + undo/redo cycle.
 * Scenario: Create → Move → Undo 2x → Redo 2x
 * The key issue: after create+move, undo uses stale expectedVersion.
 */
import { io, type Socket } from 'socket.io-client';

const API_BASE = 'http://localhost:3000';

async function api<T>(path: string, opts: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  const res = await fetch(`${API_BASE}${path}`, { method: opts.method ?? 'GET', headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  if (!res.ok) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

function waitFor<T>(socket: Socket, event: string, ms = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout: ${event}`)), ms);
    socket.once(event, (d: T) => { clearTimeout(t); resolve(d); });
  });
}

async function main() {
  const suffix = Date.now().toString(36);
  const email = `multi-${suffix}@t.local`;

  await api('/auth/register', { method: 'POST', body: { email, password: 'test123456', displayName: 'Multi' } });
  const session = await api<{ accessToken: string; user: { id: string } }>('/auth/login', { method: 'POST', body: { email, password: 'test123456' } });
  const token = session.accessToken;
  const userId = session.user.id;

  const room = await api<{ id: string }>('/rooms', { method: 'POST', body: { name: 'Multi Test' }, token });

  const socket = io(API_BASE, { auth: { token } });
  await new Promise<void>(r => socket.on('connect', () => r()));
  socket.emit('room:join', { roomId: room.id, lastKnownVersion: 0 });
  await waitFor(socket, 'room:joined');
  console.log('Setup ✓');

  let boardVersion = 0;
  const objId = crypto.randomUUID();

  // ── Op 1: Create rectangle ──
  console.log('\n1. Create rectangle');
  socket.emit('board:event', {
    roomId: room.id, eventType: 'object:create', baseVersion: boardVersion,
    payload: { object: { id: objId, type: 'rectangle', x: 100, y: 100, rotation: 0, props: { width: 140, height: 90, fill: '#dbeafe', stroke: '#38bdf8', strokeWidth: 2 } } },
    clientOpId: crypto.randomUUID()
  });
  const ack1 = await waitFor<{ version: number }>(socket, 'board:event:accepted');
  boardVersion = ack1.version;
  console.log(`   v${ack1.version} — object at version 1`);

  // ── Op 2: Move rectangle ──
  console.log('\n2. Move rectangle (x:100→300)');
  socket.emit('board:event', {
    roomId: room.id, eventType: 'object:update', baseVersion: boardVersion,
    payload: { objectId: objId, expectedVersion: 1, patch: { x: 300 } },
    clientOpId: crypto.randomUUID()
  });
  const ack2 = await waitFor<{ version: number }>(socket, 'board:event:accepted');
  boardVersion = ack2.version;
  console.log(`   v${ack2.version} — object at version 2, x:300`);

  // Verify: object exists at x=300
  let board = await api<{ objects: Record<string, any> }>(`/rooms/${room.id}/board`, { token });
  let obj = board.objects[objId];
  console.log(`   Check: x=${obj.x}, version=${obj.version}, deleted=${obj.deleted}`);

  // ── Undo Op 2 (move back to x=100) ──
  console.log('\n3. Undo #1: revert move (object:update back to x=100)');
  socket.emit('board:event', {
    roomId: room.id, eventType: 'object:update', baseVersion: boardVersion,
    // NO expectedVersion — undo should always succeed
    payload: { objectId: objId, patch: { x: 100 } },
    clientOpId: crypto.randomUUID()
  });
  const ackUndo1 = await waitFor<{ version: number }>(socket, 'board:event:accepted');
  boardVersion = ackUndo1.version;
  console.log(`   v${ackUndo1.version} — undo accepted ✓`);

  board = await api<{ objects: Record<string, any> }>(`/rooms/${room.id}/board`, { token });
  obj = board.objects[objId];
  console.log(`   Check: x=${obj.x}, version=${obj.version}`);

  // ── Undo Op 1 (delete object) ──
  console.log('\n4. Undo #2: delete object (undo create)');
  socket.emit('board:event', {
    roomId: room.id, eventType: 'object:delete', baseVersion: boardVersion,
    // NO expectedVersion
    payload: { objectId: objId },
    clientOpId: crypto.randomUUID()
  });
  const ackUndo2 = await waitFor<{ version: number }>(socket, 'board:event:accepted');
  boardVersion = ackUndo2.version;
  console.log(`   v${ackUndo2.version} — undo accepted ✓`);

  board = await api<{ objects: Record<string, any> }>(`/rooms/${room.id}/board`, { token });
  obj = board.objects[objId];
  console.log(`   Check: deleted=${obj.deleted} ${obj.deleted ? '✓ Object deleted' : '✗ Still exists!'}`);

  // ── Redo Op 1 (recreate object) ──
  console.log('\n5. Redo #1: recreate object');
  socket.emit('board:event', {
    roomId: room.id, eventType: 'object:create', baseVersion: boardVersion,
    payload: { object: { id: objId, type: 'rectangle', x: 100, y: 100, rotation: 0, props: { width: 140, height: 90, fill: '#dbeafe', stroke: '#38bdf8', strokeWidth: 2 } } },
    clientOpId: crypto.randomUUID()
  });
  const ackRedo1 = await waitFor<{ version: number }>(socket, 'board:event:accepted');
  boardVersion = ackRedo1.version;
  console.log(`   v${ackRedo1.version} — redo accepted ✓`);

  board = await api<{ objects: Record<string, any> }>(`/rooms/${room.id}/board`, { token });
  obj = board.objects[objId];
  console.log(`   Check: x=${obj.x}, version=${obj.version}, deleted=${obj.deleted}`);

  // ── Redo Op 2 (move forward to x=300) ──
  console.log('\n6. Redo #2: move to x=300');
  socket.emit('board:event', {
    roomId: room.id, eventType: 'object:update', baseVersion: boardVersion,
    payload: { objectId: objId, patch: { x: 300 } },
    clientOpId: crypto.randomUUID()
  });
  const ackRedo2 = await waitFor<{ version: number }>(socket, 'board:event:accepted');
  boardVersion = ackRedo2.version;
  console.log(`   v${ackRedo2.version} — redo accepted ✓`);

  board = await api<{ objects: Record<string, any> }>(`/rooms/${room.id}/board`, { token });
  obj = board.objects[objId];
  console.log(`   Check: x=${obj.x}, version=${obj.version}`);
  const finalOk = obj.x === 300 && !obj.deleted;
  console.log(`\n   Final: x=${obj.x} ${finalOk ? '✓ CORRECT' : '✗ WRONG (expected x=300, not deleted)'}`);

  socket.disconnect();
  console.log(`\n═══ ${finalOk ? 'ALL PASSED ✓' : 'FAILED ✗'} ═══`);
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });

/**
 * Comprehensive test of undo/redo/restore flow.
 * Scenario: Create 2 objects → Restore to v1 → Only 1 object remains
 */
import { io, type Socket } from 'socket.io-client';

const API_BASE = 'http://localhost:3000';

// ── Helpers ──
async function api<T>(path: string, opts: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method ?? 'GET', headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
  });
  if (!res.ok) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function setupUser(name: string) {
  const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const email = `${name.toLowerCase()}-${suffix}@t.local`;
  await api('/auth/register', { method: 'POST', body: { email, password: 'test123456', displayName: name } });
  const session = await api<{ accessToken: string; user: { id: string } }>('/auth/login', { method: 'POST', body: { email, password: 'test123456' } });
  return { ...session, email };
}

function waitFor<T>(socket: Socket, event: string, ms = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout: ${event}`)), ms);
    socket.once(event, (d: T) => { clearTimeout(t); resolve(d); });
  });
}

async function main() {
  console.log('═══ Full Flow Test: Undo/Redo/Restore ═══\n');

  // ── Setup ──
  const alice = await setupUser('Alice');
  console.log('1. Alice logged in ✓');

  const room = await api<{ id: string; name: string }>('/rooms', { method: 'POST', body: { name: 'Flow Test' }, token: alice.accessToken });
  console.log('2. Room created ✓');

  const socket = io(API_BASE, { auth: { token: alice.accessToken } });
  await new Promise<void>(r => socket.on('connect', () => r()));
  socket.emit('room:join', { roomId: room.id, lastKnownVersion: 0 });
  await waitFor(socket, 'room:joined');
  console.log('3. Joined room via WebSocket ✓');

  let boardVersion = 0;

  // ── Create Object 1 ──
  console.log('\n─── Creating Object 1 (rectangle) ───');
  const obj1Id = crypto.randomUUID();
  socket.emit('board:event', {
    roomId: room.id, eventType: 'object:create', baseVersion: boardVersion,
    payload: { object: { id: obj1Id, type: 'rectangle', x: 100, y: 100, rotation: 0, props: { width: 140, height: 90, fill: '#dbeafe', stroke: '#38bdf8', strokeWidth: 2 } } },
    clientOpId: crypto.randomUUID()
  });
  const ack1 = await waitFor<{ version: number }>(socket, 'board:event:accepted');
  boardVersion = ack1.version;
  console.log(`   Created obj1 at v${ack1.version}`);

  // ── Verify: 1 object ──
  const board1 = await api<{ version: number; objects: Record<string, unknown> }>(`/rooms/${room.id}/board`, { token: alice.accessToken });
  const count1 = Object.values(board1.objects).filter((o: any) => !o.deleted).length;
  console.log(`   Board has ${count1} active object(s) ${count1 === 1 ? '✓' : '✗'}`);

  // ── Create Object 2 ──
  console.log('\n─── Creating Object 2 (circle) ───');
  const obj2Id = crypto.randomUUID();
  socket.emit('board:event', {
    roomId: room.id, eventType: 'object:create', baseVersion: boardVersion,
    payload: { object: { id: obj2Id, type: 'circle', x: 400, y: 300, rotation: 0, props: { radius: 60, fill: '#ecfccb', stroke: '#4d7c0f', strokeWidth: 2 } } },
    clientOpId: crypto.randomUUID()
  });
  const ack2 = await waitFor<{ version: number }>(socket, 'board:event:accepted');
  boardVersion = ack2.version;
  console.log(`   Created obj2 at v${ack2.version}`);

  // ── Verify: 2 objects ──
  const board2 = await api<{ version: number; objects: Record<string, unknown> }>(`/rooms/${room.id}/board`, { token: alice.accessToken });
  const count2 = Object.values(board2.objects).filter((o: any) => !o.deleted).length;
  console.log(`   Board has ${count2} active object(s) ${count2 === 2 ? '✓' : '✗'}`);

  // ── Restore to v1 (should have only obj1) ──
  console.log('\n─── Restore to v1 (should have only obj1) ───');
  const restoreRes = await api<{ version: number; restoredFromVersion: number }>(`/rooms/${room.id}/versions/1/restore`, { method: 'POST', token: alice.accessToken });
  boardVersion = restoreRes.version;
  console.log(`   Restored to v1, now at v${restoreRes.version}`);

  // ── Verify after restore: 1 object ──
  const boardRestored = await api<{ version: number; objects: Record<string, unknown> }>(`/rooms/${room.id}/board`, { token: alice.accessToken });
  const countRestored = Object.values(boardRestored.objects).filter((o: any) => !o.deleted).length;
  console.log(`   Board has ${countRestored} active object(s)`);
  if (countRestored === 1) console.log('   ✓ Restore correct: only 1 object remains');
  else if (countRestored === 0) console.log('   ✗ BUG: Board is empty — should have 1 object!');
  else console.log(`   ✗ BUG: Board has ${countRestored} objects — should have 1!`);

  // Show what objects are in the board
  for (const [id, obj] of Object.entries(boardRestored.objects)) {
    const o = obj as any;
    console.log(`   Object: type=${o.type}, deleted=${o.deleted}, version=${o.version}, x=${o.x}, y=${o.y}`);
    if (o.props) console.log(`     props: ${JSON.stringify(o.props).slice(0, 100)}`);
  }

  // ── Test Undo ──
  console.log('\n─── Create an object, then Undo ───');
  const obj3Id = crypto.randomUUID();
  socket.emit('board:event', {
    roomId: room.id, eventType: 'object:create', baseVersion: boardVersion,
    payload: { object: { id: obj3Id, type: 'text', x: 200, y: 400, rotation: 0, props: { text: 'Test undo', fontSize: 20, fill: '#dae2fd', width: 220 } } },
    clientOpId: crypto.randomUUID()
  });
  const ack3 = await waitFor<{ version: number }>(socket, 'board:event:accepted');
  boardVersion = ack3.version;
  console.log(`   Created obj3 at v${ack3.version}`);

  const board3 = await api<{ version: number; objects: Record<string, unknown> }>(`/rooms/${room.id}/board`, { token: alice.accessToken });
  const count3 = Object.values(board3.objects).filter((o: any) => !o.deleted).length;
  console.log(`   Before undo: ${count3} objects`);

  // Undo: delete obj3
  console.log('   Sending undo (delete obj3)...');
  socket.emit('board:event', {
    roomId: room.id, eventType: 'object:delete', baseVersion: boardVersion,
    payload: { objectId: obj3Id, expectedVersion: 1 },
    clientOpId: crypto.randomUUID()
  });
  const ackUndo = await waitFor<{ version: number }>(socket, 'board:event:accepted');
  boardVersion = ackUndo.version;
  console.log(`   Undo accepted at v${ackUndo.version}`);

  const boardUndo = await api<{ version: number; objects: Record<string, unknown> }>(`/rooms/${room.id}/board`, { token: alice.accessToken });
  const countUndo = Object.values(boardUndo.objects).filter((o: any) => !o.deleted).length;
  console.log(`   After undo: ${countUndo} active objects ${countUndo === countRestored ? '✓' : '✗'}`);

  // ── Test Redo ──
  console.log('\n─── Redo (re-create obj3) ───');
  socket.emit('board:event', {
    roomId: room.id, eventType: 'object:create', baseVersion: boardVersion,
    payload: { object: { id: obj3Id, type: 'text', x: 200, y: 400, rotation: 0, props: { text: 'Test undo', fontSize: 20, fill: '#dae2fd', width: 220 } } },
    clientOpId: crypto.randomUUID()
  });
  const ackRedo = await waitFor<{ version: number }>(socket, 'board:event:accepted');
  boardVersion = ackRedo.version;
  console.log(`   Redo accepted at v${ackRedo.version}`);

  const boardRedo = await api<{ version: number; objects: Record<string, unknown> }>(`/rooms/${room.id}/board`, { token: alice.accessToken });
  const countRedo = Object.values(boardRedo.objects).filter((o: any) => !o.deleted).length;
  console.log(`   After redo: ${countRedo} active objects ${countRedo === countUndo + 1 ? '✓' : '✗'}`);

  // ── Test Restore to v0 (empty board) ──
  console.log('\n─── Restore to v0 (empty board) ──');
  const restoreV0 = await api<{ version: number }>(`/rooms/${room.id}/versions/0/restore`, { method: 'POST', token: alice.accessToken });
  console.log(`   Restored to v0, now at v${restoreV0.version}`);

  const boardV0 = await api<{ version: number; objects: Record<string, unknown> }>(`/rooms/${room.id}/board`, { token: alice.accessToken });
  const countV0 = Object.values(boardV0.objects).filter((o: any) => !o.deleted).length;
  console.log(`   Board has ${countV0} objects ${countV0 === 0 ? '✓ Empty as expected' : '✗ Should be empty!'}`);

  socket.disconnect();
  console.log('\n═══ Full Flow Test Complete ═══');
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });

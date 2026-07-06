/**
 * Test undo/redo by simulating what the frontend does
 */
import { io } from 'socket.io-client';

const API_BASE = 'http://localhost:3000';

async function main() {
  const suffix = Date.now().toString(36);
  const email = `undo-${suffix}@t.local`;

  // Setup
  const regRes = await fetch(`${API_BASE}/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'test123456', displayName: 'UndoTest' })
  });
  await regRes.json();

  const loginRes = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'test123456' })
  });
  const session = await loginRes.json() as { accessToken: string; user: { id: string } };
  const token = session.accessToken;
  const userId = session.user.id;

  const roomRes = await fetch(`${API_BASE}/rooms`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ name: 'Undo Test' })
  });
  const room = await roomRes.json() as { id: string };

  // Connect
  const socket = io(API_BASE, { auth: { token } });
  await new Promise<void>((resolve) => socket.on('connect', () => resolve()));
  console.log('Connected ✓');

  // Join room
  socket.emit('room:join', { roomId: room.id, lastKnownVersion: 0 });
  const joined = await new Promise<any>((resolve) => socket.once('room:joined', resolve));
  console.log(`Joined. v${joined.currentVersion}, sync: ${joined.syncMode}`);

  let boardVersion = joined.currentVersion;

  // Step 1: Create a rectangle (like sendRectangleCreate)
  console.log('\n--- Step 1: Create rectangle ---');
  const objectId = crypto.randomUUID();
  const createPayload = {
    object: { id: objectId, type: 'rectangle', x: 100, y: 200, rotation: 0, props: { width: 140, height: 90, fill: '#dbeafe', stroke: '#38bdf8', strokeWidth: 2 } }
  };

  // Simulate createHistoryEntry for create
  const undoDeletePayload = { objectId, expectedVersion: 1 };
  const createOp = { eventType: 'object:create' as const, payload: createPayload };

  socket.emit('board:event', {
    roomId: room.id, eventType: 'object:create', baseVersion: boardVersion,
    payload: createPayload, clientOpId: crypto.randomUUID()
  });

  const createAck = await new Promise<any>((resolve) => socket.once('board:event:accepted', resolve));
  boardVersion = createAck.version;
  console.log(`Rectangle created. v${createAck.version}, object version: 1`);
  console.log(`Undo would send: object:delete id=${objectId} expectedVersion=1 baseVersion=${boardVersion}`);

  // Step 2: Now undo - send the inverse operation
  console.log('\n--- Step 2: Undo (delete) ---');
  const undoOp = { eventType: 'object:delete' as const, payload: undoDeletePayload };

  socket.emit('board:event', {
    roomId: room.id, eventType: 'object:delete', baseVersion: boardVersion,
    payload: undoDeletePayload, clientOpId: crypto.randomUUID()
  });

  const undoAck = await new Promise<any>((resolve) => socket.once('board:event:accepted', resolve));
  boardVersion = undoAck.version;
  console.log(`Undo accepted. v${undoAck.version}`);
  console.log(`ACK payload:`, JSON.stringify(undoAck).slice(0, 200));

  // Step 3: Verify object is deleted on server
  console.log('\n--- Step 3: Verify object state ---');
  socket.emit('room:join', { roomId: room.id, lastKnownVersion: 0 });
  const snapshot = await new Promise<any>((resolve) => socket.once('room:joined', resolve));
  if (snapshot.snapshot) {
    const obj = snapshot.snapshot.objects?.[objectId];
    console.log(`Object in snapshot:`, obj ? `version=${obj.version}, deleted=${obj.deleted}` : 'NOT FOUND');
    if (obj?.deleted) console.log('✓ Object is properly deleted (undo worked)');
    else if (obj) console.log('✗ Object still exists, not deleted!');
  } else if (snapshot.missedEvents) {
    console.log(`Missed events: ${snapshot.missedEvents.length}`);
    for (const evt of snapshot.missedEvents) {
      console.log(`  v${evt.version}: ${evt.eventType} on ${evt.payload?.objectId?.slice(0, 8) || evt.payload?.object?.id?.slice(0, 8) || '?'}`);
    }
  }

  // Step 4: Test that redo would work (create again)
  console.log('\n--- Step 4: Redo (re-create) ---');
  socket.emit('board:event', {
    roomId: room.id, eventType: 'object:create', baseVersion: boardVersion,
    payload: createPayload, clientOpId: crypto.randomUUID()
  });

  const redoAck = await new Promise<any>((resolve) => socket.once('board:event:accepted', resolve));
  boardVersion = redoAck.version;
  console.log(`Redo (re-create) accepted. v${redoAck.version}`);

  // Verify
  socket.emit('room:join', { roomId: room.id, lastKnownVersion: 0 });
  const finalSnapshot = await new Promise<any>((resolve) => socket.once('room:joined', resolve));
  if (finalSnapshot.snapshot) {
    const obj = finalSnapshot.snapshot.objects?.[objectId];
    console.log(`Final object:`, obj ? `version=${obj.version}, deleted=${obj.deleted}` : 'NOT FOUND');
    if (obj && !obj.deleted) console.log('✓ Object re-created correctly');
  }

  // Step 5: Test restore
  console.log('\n--- Step 5: Test restore ---');
  const restoreRes = await fetch(`${API_BASE}/rooms/${room.id}/versions/1/restore`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
  });
  const restoreResult = await restoreRes.json() as { version: number; restoredFromVersion: number };
  console.log(`Restore status: ${restoreRes.status}, result:`, JSON.stringify(restoreResult));

  socket.emit('room:join', { roomId: room.id, lastKnownVersion: 0 });
  const restoredSnapshot = await new Promise<any>((resolve) => socket.once('room:joined', resolve));
  console.log(`After restore - syncMode: ${restoredSnapshot.syncMode}`);
  if (restoredSnapshot.snapshot) {
    const objCount = Object.keys(restoredSnapshot.snapshot.objects || {}).length;
    console.log(`Objects in snapshot: ${objCount}`);
  }

  socket.disconnect();
  console.log('\n═══ Undo/Redo/Restore Test Complete ═══');
}

main().catch(e => console.error('FAIL:', e.message));

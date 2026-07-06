/** Detailed test to find exact error */
import { io } from 'socket.io-client';

const API_BASE = 'http://localhost:3000';

async function main() {
  const suffix = Date.now().toString(36);
  const email = `d2-${suffix}@t.local`;

  // Register + login
  let r = await fetch(`${API_BASE}/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'test123456', displayName: 'D2' })
  });
  const user = await r.json() as { id: string };

  r = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'test123456' })
  });
  const session = await r.json() as { accessToken: string };
  const token = session.accessToken;

  // Create room
  r = await fetch(`${API_BASE}/rooms`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ name: 'Detailed' })
  });
  const room = await r.json() as { id: string };

  // Test individual services
  console.log('--- Testing getBoardSnapshotForRoom ---');
  r = await fetch(`${API_BASE}/rooms/${room.id}/board`, { headers: { 'Authorization': `Bearer ${token}` } });
  console.log('Status:', r.status, 'Body:', (await r.text()).slice(0, 200));

  console.log('--- Testing getReconnectSync via WS ---');
  const socket = io(API_BASE, { auth: { token } });

  await new Promise<void>((resolve) => {
    socket.on('connect', () => resolve());
    setTimeout(() => resolve(), 3000);
  });

  // Try joining
  socket.emit('room:join', { roomId: room.id, lastKnownVersion: 0 });

  // Listen for ALL possible events
  const events = ['room:joined', 'error', 'exception', 'board:event:accepted', 'board:event:rejected'];
  for (const evt of events) {
    socket.on(evt, (data: unknown) => {
      console.log(`\n  <<< ${evt}:`, JSON.stringify(data).slice(0, 500));
    });
  }

  await new Promise((r) => setTimeout(r, 3000));

  console.log('\n--- Direct board event ---');
  socket.emit('board:event', {
    roomId: room.id, eventType: 'object:create', baseVersion: 0,
    payload: { object: { id: crypto.randomUUID(), type: 'rectangle', x: 100, y: 100, props: { width: 100, height: 80, fill: '#dbeafe', stroke: '#38bdf8', strokeWidth: 2 } } },
    clientOpId: crypto.randomUUID(),
  });

  await new Promise((r) => setTimeout(r, 2000));
  socket.disconnect();
  console.log('\nDone.');
}

main().catch(e => console.error('FAIL:', e.message));

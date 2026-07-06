/**
 * Quick WebSocket connectivity test
 */
import { io } from 'socket.io-client';

const API_BASE = 'http://localhost:3000';

async function main() {
  // Register + login
  const suffix = Date.now().toString(36);
  const email = `test-${suffix}@test.local`;

  console.log('Registering...');
  const regRes = await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'test123456', displayName: 'Tester' }),
  });
  const user = await regRes.json() as { id: string };
  console.log('Registered:', user.id.slice(0, 8));

  console.log('Logging in...');
  const loginRes = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'test123456' }),
  });
  const session = await loginRes.json() as { accessToken: string };
  const token = session.accessToken;
  console.log('Got token');

  // Create room
  console.log('Creating room...');
  const roomRes = await fetch(`${API_BASE}/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: 'Quick Test' }),
  });
  const room = await roomRes.json() as { id: string };
  console.log('Room:', room.id.slice(0, 8));

  // Connect WebSocket
  console.log('Connecting WebSocket...');
  const socket = io(API_BASE, {
    auth: { token },
    transports: ['websocket'],
  });

  socket.on('connect', () => {
    console.log('WS connected ✓');
  });
  socket.on('connect_error', (err: Error) => {
    console.log('WS connect_error:', err.message);
    process.exit(1);
  });
  socket.on('error', (payload: unknown) => {
    console.log('WS error:', JSON.stringify(payload));
  });
  socket.on('room:joined', (payload: unknown) => {
    console.log('room:joined:', JSON.stringify(payload).slice(0, 200));
  });
  socket.on('board:event:accepted', (p: unknown) => {
    console.log('event:accepted:', JSON.stringify(p).slice(0, 100));
  });
  socket.on('board:event:broadcast', (p: unknown) => {
    console.log('event:broadcast:', JSON.stringify(p).slice(0, 100));
  });
  socket.on('board:event:rejected', (p: unknown) => {
    console.log('event:rejected:', JSON.stringify(p));
  });

  await new Promise<void>((resolve) => {
    socket.on('connect', () => resolve());
  });

  // Join room
  console.log('Joining room...');
  socket.emit('room:join', { roomId: room.id, lastKnownVersion: 0 });

  // Wait a bit
  await new Promise((r) => setTimeout(r, 1000));

  // Create object
  console.log('Creating rectangle...');
  const objectId = crypto.randomUUID();
  socket.emit('board:event', {
    roomId: room.id,
    eventType: 'object:create',
    baseVersion: 0,
    payload: {
      object: {
        id: objectId,
        type: 'rectangle',
        x: 100, y: 200, rotation: 0,
        props: { width: 100, height: 80, fill: '#dbeafe', stroke: '#38bdf8', strokeWidth: 2 },
      },
    },
    clientOpId: crypto.randomUUID(),
  });

  await new Promise((r) => setTimeout(r, 1500));

  socket.disconnect();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});

/**
 * Debug test - logs ALL socket events
 */
import { io } from 'socket.io-client';

const API_BASE = 'http://localhost:3000';

async function main() {
  const suffix = Date.now().toString(36);
  const email = `d-${suffix}@t.local`;

  // Register + login
  const regRes = await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'test123456', displayName: 'Debug' }),
  });
  const user = await regRes.json() as { id: string };
  console.log('User:', user.id.slice(0, 8));

  const loginRes = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'test123456' }),
  });
  const session = await loginRes.json() as { accessToken: string };
  const token = session.accessToken;

  const roomRes = await fetch(`${API_BASE}/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: 'Debug Room' }),
  });
  const room = await roomRes.json() as { id: string };
  console.log('Room:', room.id.slice(0, 8));

  // Connect - try WITHOUT transports restriction (allow polling fallback)
  console.log('\n--- Connecting WebSocket ---');
  const socket = io(API_BASE, {
    auth: { token },
    // Don't restrict transports
  });

  // Log ALL events
  const origOnevent = (socket as any).onevent;
  (socket as any).onevent = function (packet: any) {
    const args = packet.data || [];
    console.log(`\n  >>> EVENT: "${packet.type !== undefined ? args[0] : '?'}" ` +
      `data=${JSON.stringify(args.slice(1)).slice(0, 300)}`);
    origOnevent.call(this, packet);
  };

  socket.on('connect', () => console.log('connect ✓'));
  socket.on('connect_error', (e: Error) => console.log('connect_error:', e.message));
  socket.on('disconnect', (reason: string) => console.log('disconnect:', reason));

  await new Promise<void>((resolve) => {
    socket.on('connect', () => resolve());
    setTimeout(() => resolve(), 3000);
  });

  console.log('\n--- Emitting room:join ---');
  socket.emit('room:join', { roomId: room.id, lastKnownVersion: 0 });

  await new Promise((r) => setTimeout(r, 3000));

  console.log('\n--- Emitting board:event ---');
  socket.emit('board:event', {
    roomId: room.id,
    eventType: 'object:create',
    baseVersion: 0,
    payload: {
      object: {
        id: crypto.randomUUID(),
        type: 'rectangle',
        x: 100, y: 100,
        props: { width: 100, height: 80, fill: '#dbeafe', stroke: '#38bdf8', strokeWidth: 2 },
      },
    },
    clientOpId: crypto.randomUUID(),
  });

  await new Promise((r) => setTimeout(r, 3000));

  socket.disconnect();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});

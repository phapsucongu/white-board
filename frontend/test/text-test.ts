import { io } from 'socket.io-client';

const B = 'http://localhost:3000';
const suffix = Date.now().toString(36);

async function main() {
  const email = `txt-${suffix}@t.local`;

  // Register + login
  await fetch(B + '/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'test123456', displayName: 'T' })
  });
  const s = await (await fetch(B + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'test123456' })
  })).json() as { accessToken: string };
  const token = s.accessToken;

  // Create room
  const room = await (await fetch(B + '/rooms', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ name: 'T' })
  })).json() as { id: string };
  console.log('Room:', room.id.slice(0, 8));

  // Connect socket
  const socket = io(B, { auth: { token } });
  await new Promise<void>(r => socket.on('connect', () => r()));
  socket.emit('room:join', { roomId: room.id, lastKnownVersion: 0 });
  await new Promise(r => socket.once('room:joined', () => r()));
  console.log('Joined room');

  // Create TEXT object
  const textId = crypto.randomUUID();
  socket.emit('board:event', {
    roomId: room.id, eventType: 'object:create', baseVersion: 0,
    payload: {
      object: {
        id: textId, type: 'text', x: 200, y: 300, rotation: 0,
        props: { text: 'Hello world', fontSize: 20, fill: '#dae2fd', width: 220 }
      }
    },
    clientOpId: crypto.randomUUID()
  });

  const ack = await new Promise<any>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), 5000);
    socket.once('board:event:accepted', (d) => { clearTimeout(t); resolve(d); });
    socket.once('board:event:rejected', (d) => { clearTimeout(t); reject(new Error(JSON.stringify(d))); });
  });
  console.log('Text created, version:', ack.version);

  // Verify via REST
  const boardRes = await fetch(B + '/rooms/' + room.id + '/board', {
    headers: { 'Authorization': 'Bearer ' + token }
  });
  const board = await boardRes.json() as { objects: Record<string, any> };
  const obj = board.objects[textId];
  if (obj) {
    console.log('Found in board: type=' + obj.type + ', text="' + obj.props?.text + '"');
    console.log('✓ Text creation works');
  } else {
    console.log('✗ Text object NOT found in board snapshot!');
  }

  // Test via REST: create rectangle then text
  console.log('\nTest: get board state version...');
  console.log('Board version:', board.version, 'objects:', Object.keys(board.objects).length);

  socket.disconnect();
}

main().catch(e => console.error('FAIL:', e.message));

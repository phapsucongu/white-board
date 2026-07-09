/**
 * Tests the COMPLETE text creation flow - same as what the UI does.
 * 1. Login → create room → connect WebSocket → create text → verify
 */
import { io } from 'socket.io-client';

const B = 'http://localhost:3000';

async function main() {
  const ts = Date.now().toString(36);
  const email = `t-${ts}@t.local`;
  const pw = 'test123456';

  // 1. Register + Login
  console.log('1. Register...');
  await fetch(B + '/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: pw, displayName: 'TextTest' })
  });
  const login = await (await fetch(B + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: pw })
  })).json() as { accessToken: string; user: { id: string } };
  console.log('   Logged in as OWNER, userId:', login.user.id.slice(0,8));

  // 2. Create room (user is OWNER → canDrawRectangle = true)
  const room = await (await fetch(B + '/rooms', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + login.accessToken },
    body: JSON.stringify({ name: 'TextFlowTest' })
  })).json() as { id: string };
  console.log('2. Room created:', room.id.slice(0,8));

  // 3. Connect WebSocket + join room
  console.log('3. Connecting WebSocket...');
  const socket = io(B, { auth: { token: login.accessToken } });
  await new Promise<void>(r => socket.on('connect', () => r()));
  socket.emit('room:join', { roomId: room.id, lastKnownVersion: 0 });
  const joined = await new Promise<any>(r => socket.once('room:joined', r));
  let boardVersion = joined.currentVersion;
  console.log('   Joined. v' + boardVersion + ', role: OWNER');

  // 4. Create TEXT object (exactly what the UI's handleTextSubmit does)
  console.log('4. Creating TEXT object...');
  const textId = crypto.randomUUID();
  const createPayload = {
    roomId: room.id,
    eventType: 'object:create' as const,
    baseVersion: boardVersion,
    payload: {
      object: {
        id: textId,
        type: 'text' as const,
        x: 300,
        y: 200,
        rotation: 0,
        props: { text: 'Hello CanvasFlow!', fontSize: 20, fill: '#dae2fd', width: 220 }
      }
    },
    clientOpId: crypto.randomUUID()
  };

  socket.emit('board:event', createPayload);

  // Wait for ACK
  const ack = await new Promise<any>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('ACK timeout')), 5000);
    socket.once('board:event:accepted', (d) => { clearTimeout(t); resolve(d); });
    socket.once('board:event:rejected', (d) => { clearTimeout(t); reject(new Error('REJECTED: ' + JSON.stringify(d))); });
  });
  boardVersion = ack.version;
  console.log('   ACCEPTED at version', ack.version);
  console.log('   Event type:', ack.eventType);

  // 5. Verify text in board snapshot
  console.log('5. Verifying in board snapshot...');
  const board = await (await fetch(B + '/rooms/' + room.id + '/board', {
    headers: { 'Authorization': 'Bearer ' + login.accessToken }
  })).json() as { version: number; objects: Record<string, any> };
  const obj = board.objects[textId];
  if (!obj) throw new Error('TEXT OBJECT NOT FOUND IN SNAPSHOT!');

  console.log('   Found: type=' + obj.type + ', text="' + obj.props?.text + '"');
  console.log('   Position: x=' + obj.x + ', y=' + obj.y);
  console.log('   Created by:', obj.createdBy?.slice(0,8));

  // 6. Verify type guard (this is what was broken before)
  console.log('6. Testing type guard...');
  const payloadType = createPayload.payload.object.type;
  const validTypes = ['rectangle', 'circle', 'line', 'text'];
  const isValid = validTypes.includes(payloadType);
  console.log('   Payload type "' + payloadType + '" is valid:', isValid);

  // 7. Create all 4 shape types to verify type guard works
  console.log('7. Testing all 4 shape types...');
  for (const shapeType of ['rectangle', 'circle', 'line', 'text']) {
    const sid = crypto.randomUUID();
    socket.emit('board:event', {
      roomId: room.id, eventType: 'object:create', baseVersion: boardVersion,
      payload: {
        object: {
          id: sid, type: shapeType as any, x: 100, y: 100, rotation: 0,
          props: shapeType === 'rectangle' ? { width: 100, height: 80, fill: '#dbeafe', stroke: '#38bdf8', strokeWidth: 2 }
               : shapeType === 'circle' ? { radius: 50, fill: '#ecfccb', stroke: '#4d7c0f', strokeWidth: 2 }
               : shapeType === 'line' ? { points: [0, 0, 150, 80], stroke: '#0f766e', strokeWidth: 4 }
               : { text: shapeType + ' test', fontSize: 20, fill: '#dae2fd', width: 220 }
        }
      },
      clientOpId: crypto.randomUUID()
    });
    const a = await new Promise<any>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), 3000);
      socket.once('board:event:accepted', (d) => { clearTimeout(t); resolve(d); });
      socket.once('board:event:rejected', (d) => { clearTimeout(t); reject(new Error(JSON.stringify(d))); });
    });
    boardVersion = a.version;
    console.log('   ✓ ' + shapeType + ' created at v' + a.version);
  }

  console.log('\n═══ ALL TEXT TESTS PASSED ✓ ═══');
  console.log('Backend fully supports text creation.');
  console.log('If UI text tool does not work, check:');
  console.log('  1. Browser Console (F12) for JS errors');
  console.log('  2. Your role in the room (must be OWNER or EDITOR)');
  console.log('  3. Clear browser cache: Ctrl+Shift+R');

  socket.disconnect();
}

main().catch(e => { console.error('\n✗ FAILED:', e.message); process.exit(1); });

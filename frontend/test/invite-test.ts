/**
 * Test invite code flow: Alice creates room, gets code, Bob joins by code
 */
async function main() {
  const B = 'http://localhost:3000';
  const suffix = Date.now().toString(36);

  // Register Alice and Bob
  const regA = await fetch(B + '/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `alice-${suffix}@t.local`, password: 'test123456', displayName: 'Alice' })
  });
  const userA = await regA.json() as { id: string };
  console.log('1. Alice registered:', userA.id.slice(0, 8));

  const regB = await fetch(B + '/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `bob-${suffix}@t.local`, password: 'test123456', displayName: 'Bob' })
  });
  const userB = await regB.json() as { id: string };
  console.log('2. Bob registered:', userB.id.slice(0, 8));

  // Login both
  const loginA = await fetch(B + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `alice-${suffix}@t.local`, password: 'test123456' })
  });
  const sessionA = await loginA.json() as { accessToken: string };
  const tokenA = sessionA.accessToken;

  const loginB = await fetch(B + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `bob-${suffix}@t.local`, password: 'test123456' })
  });
  const sessionB = await loginB.json() as { accessToken: string };
  const tokenB = sessionB.accessToken;
  console.log('3. Both logged in ✓');

  // Alice creates room
  const createRes = await fetch(B + '/rooms', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenA}` },
    body: JSON.stringify({ name: 'Invite Test Room' })
  });
  const room = await createRes.json() as { id: string; name: string };
  console.log('4. Room created:', room.name, room.id.slice(0, 8));

  // Get room details to see inviteCode
  const getRoom = await fetch(B + '/rooms/' + room.id, {
    headers: { 'Authorization': `Bearer ${tokenA}` }
  });
  const roomDetail = await getRoom.json() as { inviteCode?: string; id: string };
  console.log('5. Room invite code:', roomDetail.inviteCode ?? '(not returned by API)');

  // Try Bob joining by invite code
  // First we need the invite code - let's check if it's returned in the room listing
  const listRooms = await fetch(B + '/rooms', {
    headers: { 'Authorization': `Bearer ${tokenA}` }
  });
  const rooms = await listRooms.json() as Array<{ id: string; inviteCode?: string }>;
  const roomWithCode = rooms.find(r => r.id === room.id);
  console.log('6. Room from list:', roomWithCode?.inviteCode ? `inviteCode: ${roomWithCode.inviteCode}` : '(inviteCode not in list response)');

  // Bob joins using the invite code (we need it - let's get it from the created room response or list)
  // Since the RoomSummary type might not include inviteCode, let's test the join endpoint with a guess first
  console.log('7. Bob tries to join with wrong code...');
  const badJoin = await fetch(B + '/rooms/join', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenB}` },
    body: JSON.stringify({ inviteCode: 'WRONG123' })
  });
  console.log('   Wrong code result:', badJoin.status, badJoin.status === 404 ? '✓ (correctly rejected)' : '(unexpected)');

  // Actually, we need the real invite code. Let's check if it's returned somewhere.
  // The Room model now has inviteCode. Let's just check what the GET /rooms/:roomId returns
  console.log('8. Full room detail:', JSON.stringify(roomDetail));

  // If inviteCode is in the response, use it
  const code = roomDetail.inviteCode;
  if (code) {
    console.log('9. Bob joins with code:', code);
    const joinRes = await fetch(B + '/rooms/join', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenB}` },
      body: JSON.stringify({ inviteCode: code })
    });
    const joined = await joinRes.json() as { name: string; role: string };
    console.log('   Join result:', joinRes.status, `name: ${joined.name}, role: ${joined.role}`);
    if (joinRes.ok) {
      console.log('   ✓ Bob joined successfully via invite code!');
    }
  } else {
    console.log('   ⚠ inviteCode not returned in room detail. May need to add it to RoomSummary type.');

    // Fallback: try to add Bob as member via the member API (for testing)
    console.log('   Fallback: Adding Bob as member directly...');
    const addRes = await fetch(B + '/rooms/' + room.id + '/members', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenA}` },
      body: JSON.stringify({ userId: userB.id, role: 'EDITOR' })
    });
    console.log('   Add member result:', addRes.status);
  }

  console.log('\n═══ Invite Code Test Complete ═══');
}

main().catch(e => console.error('FAIL:', e.message));

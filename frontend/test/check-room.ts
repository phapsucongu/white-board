async function main() {
  const B = 'http://localhost:3000';
  const suffix = Date.now().toString(36);
  const email = `x-${suffix}@t.local`;

  // register + login
  let r = await fetch(B + '/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'test123456', displayName: 'X' })
  });
  let u = await r.json() as { id: string };
  console.log('User:', u.id.slice(0, 8), 'status:', r.status);

  r = await fetch(B + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'test123456' })
  });
  let s = await r.json() as { accessToken: string };
  let token = s.accessToken;
  console.log('Login status:', r.status);

  // create room
  r = await fetch(B + '/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ name: 'XR' })
  });
  let room = await r.json() as { id: string; name: string };
  console.log('Room status:', r.status, 'room:', room.name, room.id?.slice(0, 8));

  // get board state
  r = await fetch(B + '/rooms/' + room.id + '/board', {
    headers: { 'Authorization': 'Bearer ' + token }
  });
  let board = await r.json();
  console.log('Board status:', r.status, JSON.stringify(board).slice(0, 200));

  // get versions
  r = await fetch(B + '/rooms/' + room.id + '/versions', {
    headers: { 'Authorization': 'Bearer ' + token }
  });
  let versions = await r.json() as { events: unknown[]; currentVersion: number };
  console.log('Versions status:', r.status, 'events:', versions.events?.length, 'version:', versions.currentVersion);
}

main().catch(e => console.error('FAIL:', e.message));

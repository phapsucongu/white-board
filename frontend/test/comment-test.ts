async function main() {
  const B = 'http://localhost:3000';
  const suffix = Date.now().toString(36);
  const email = `ct-${suffix}@t.local`;

  // Register + login
  const regRes = await fetch(B + '/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'test123456', displayName: 'CTest' })
  });
  console.log('Register:', regRes.status);

  const loginRes = await fetch(B + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'test123456' })
  });
  const session = await loginRes.json() as { accessToken: string };
  const token = session.accessToken;
  console.log('Login:', loginRes.status);

  // Create room
  const roomRes = await fetch(B + '/rooms', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ name: 'CTest' })
  });
  const room = await roomRes.json() as { id: string };
  console.log('Room:', room.id.slice(0, 8));

  // Create comment
  const createRes = await fetch(B + '/rooms/' + room.id + '/comments', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ body: 'Test comment from API test', x: 100, y: 200 })
  });
  console.log('Create comment status:', createRes.status);
  const created = await createRes.json();
  console.log('Created:', JSON.stringify(created).slice(0, 200));

  // List comments
  const listRes = await fetch(B + '/rooms/' + room.id + '/comments', {
    headers: { 'Authorization': 'Bearer ' + token }
  });
  console.log('List status:', listRes.status);
  const comments = await listRes.json() as Array<unknown>;
  console.log('Comment count:', comments.length);
  if (comments.length > 0) console.log('First:', JSON.stringify(comments[0]).slice(0, 200));

  // Reload - list again
  const listRes2 = await fetch(B + '/rooms/' + room.id + '/comments', {
    headers: { 'Authorization': 'Bearer ' + token }
  });
  const comments2 = await listRes2.json() as Array<unknown>;
  console.log('Reload count:', comments2.length);
  console.log(comments2.length > 0 ? '✓ Comments persist across requests' : '✗ Comments lost!');
}

main().catch(e => console.error('FAIL:', e.message));

export type QueuedOperationStatus = 'pending' | 'conflicted';

export type QueuedOperation = {
  id: string;
  roomId: string;
  eventName: 'board:event';
  payload: unknown;
  createdAt: string;
  updatedAt?: string;
  status?: QueuedOperationStatus;
  conflict?: unknown;
};

const DB_NAME = 'whiteboard-offline';
const STORE_NAME = 'outbox';
const DB_VERSION = 2;

export async function enqueueOfflineOperation(
  operation: Omit<QueuedOperation, 'createdAt'>
): Promise<void> {
  const db = await openOutboxDb();
  await requestToPromise(
    db
      .transaction(STORE_NAME, 'readwrite')
      .objectStore(STORE_NAME)
      .put({ ...operation, createdAt: new Date().toISOString() })
  );
  db.close();
}

export async function listOfflineOperations(roomId: string): Promise<QueuedOperation[]> {
  const db = await openOutboxDb();
  const all = await requestToPromise<QueuedOperation[]>(
    db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll()
  );
  db.close();

  return all
    .filter((operation) => operation.roomId === roomId && operation.status !== 'conflicted')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function listConflictedOfflineOperations(roomId: string): Promise<QueuedOperation[]> {
  const db = await openOutboxDb();
  const all = await requestToPromise<QueuedOperation[]>(
    db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll()
  );
  db.close();

  return all
    .filter((operation) => operation.roomId === roomId && operation.status === 'conflicted')
    .sort((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt));
}

export async function countPendingOfflineOperations(roomId: string): Promise<number> {
  return listOfflineOperations(roomId).then((operations) => operations.length);
}

export async function markOfflineOperationConflicted(id: string, conflict: unknown): Promise<void> {
  const db = await openOutboxDb();
  const operation = await requestToPromise<QueuedOperation | undefined>(
    db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id)
  );

  if (operation) {
    await requestToPromise(
      db
        .transaction(STORE_NAME, 'readwrite')
        .objectStore(STORE_NAME)
        .put({
          ...operation,
          status: 'conflicted',
          conflict,
          updatedAt: new Date().toISOString()
        })
    );
  }

  db.close();
}

export async function removeOfflineOperation(id: string): Promise<void> {
  const db = await openOutboxDb();
  await requestToPromise(db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(id));
  db.close();
}

function openOutboxDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function requestToPromise<T = unknown>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

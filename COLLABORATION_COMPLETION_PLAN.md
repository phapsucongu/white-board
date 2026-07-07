# Collaboration Completion Plan

## Scope

Complete the remaining collaboration work for text editing locks and offline conflict handling.

## Status

- Phase 1 text lease lock: completed.
- Phase 2 offline conflict drawer: completed.
- Phase 3 current text conflict strategy: completed for lease conflict and whole-text `props.text` conflict; live per-character text editing remains future work.

## 1. Collaborative Text Editing Lock

- Keep text locks as soft leases with a 30 second TTL.
- [x] Renew the lease every 10 seconds while a user is editing a text object.
- [x] Prevent a second user from opening the text editor when another active lease exists.
- [x] Reject text commits on the backend when another user owns an active lease.
- [x] Broadcast lease updates and denials so clients can show who is editing.

Done when: users see who is editing, blocked users get feedback, disconnected leases expire, and stale commits are rejected by the server.

## 2. Offline Conflict Drawer

- [x] Persist rejected replay operations as `conflicted` in IndexedDB.
- [x] Expose conflicted operations from the realtime hook.
- [x] Add a room-level conflict drawer that lists conflicted changes, conflict fields, and operation age.
- [x] Support discarding a local conflicted operation.
- [x] Support retrying an operation against the latest board/object version when safe.

Done when: rejected offline operations are visible, not silently lost, and users can retry or discard them.

## 3. Text Conflict Strategy

- [x] Keep Yjs as the long-term text collaboration path.
- [x] For current whole-text object patches, reject same-field `props.text` conflicts.
- [x] For text Yjs commits, treat another user's active lease as a conflict and return a structured rejection.
- [x] Document that deeper live per-character editing remains future work.

Done when: concurrent text object edits either flow through the lease owner or fail with clear conflict feedback.

## Verification

- Backend tests cover lease ownership and text update rejection.
- Frontend tests cover conflict formatting helpers.
- Run `pnpm lint`, backend tests, frontend tests, and `pnpm build`.
- Restart Docker backend and verify `http://localhost:3001/health`.

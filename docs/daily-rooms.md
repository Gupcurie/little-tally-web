# Daily angel/devil rooms and job permissions

The authenticated chooser has nine entries: angel/devil × beginner/experienced × dismantle/place, plus keeping the previously active ledger. New users therefore remain personal when choosing the ninth entry; existing users keep their selected custom group or personal ledger. Username 123 repeats this chooser on every fresh load. Other users choose once per Beijing day; the version-2 profile upgrade prompts older profiles once.

Each day/kind has exactly one room, created lazily under an advisory lock. New days retain the latest same-kind item definitions/ratios, with quantities, records, subcategory amounts, plans and private metadata cleared. The first room can use the joining user's item template. Earlier day rooms retain records and reject quantity writes. Ordinary personal/custom ledgers keep their previous behavior.

## Permissions

Database membership is authoritative. Auth user metadata controls display preferences only and cannot grant job rights.

| Daily job | Writable | Hidden/protected |
| --- | --- | --- |
| Dismantle | sales, dismantle stock, their optional binding | egg records and future recommendation/seed |
| Place | egg records, ratios and recommendation; optional placement stock | sales and dismantle stock |

Placement stock is a separate canonical `placementStock` book. It is projected as the UI's `stock` only for placement members who enabled it. It defaults off, is a standalone end-of-shift count, and has no sales/egg automatic linkage. Dismantle stock remains canonical `stock`. Both jobs can read today's matching and candidate issue ranges through a restricted comparison response that contains only today's past sales/egg records, never future plans or either inventory.

Choosing a different job requires a UI confirmation and reloads the server projection. Direct requests still enforce the database job. A separate client role marker is checked only for stale-job detection. It does not grant access. Optional stock visibility is an authenticated member preference. Switching to personal/custom teams restores the user's prior outside feature choices, where ordinary enabled-book settings remain available.

Members can see all daily-room members and their jobs, and any current member can remove another current member, including the creator. A removed member immediately loses read/write access. Daily removal does not impose an additional account ban; deliberate role selection can join the open daily room again. Ordinary custom groups retain owner-only removal and their previous exclusion behavior. Daily rooms cannot be dissolved or collectively reset through member actions.

## Data/API contract

Migration `20261113164132_daily_role_rooms.sql` adds private RLS-protected `daily_rooms`, `daily_memberships` and a bounded `daily_mutations` journal. No client table grants are added. Old public team read/save/previous, period read/close and dissolve functions move to revoked private implementations. Guarded public wrappers preserve ordinary-team behavior and project/merge daily-role data. Exports/restores/previous snapshots use the same projected view; raw opposite-role history and future plans are never returned to staff. Administrators retain complete authorized access, with placement inventory shown separately.

Daily canonical writes merge only the authorized job's books. Per-job edit revisions allow simultaneous opposite-job saves without overwriting one another. Concurrent edits within one job still conflict and reload. Alias changes use a separate expected alias hash, preventing silent cross-job alias overwrites. The last 500 mutation IDs per room support exact retries after lost responses; an expired retry is still blocked by its stale job revision. Confirmed saves return a fresh authorized projection and global revision. Ordinary teams retain the original CAS behavior.

Reloads discard superseded or older revisions, including stale empty reads after a new ledger was saved. Permission errors reload instead of retrying a forbidden write as an uncertain operation. Job projection changes clear the prior local projection cache. Database checks remain in effect even when UI controls are bypassed.

## Tutorials and verification

Each daily job has an eight-step tutorial covering room membership/removal, role boundaries, recording, daily comparison/candidate ranges, independent inventories, switching/keeping prior ledgers, and Settings replay plus user-supplied contacts. Standalone/custom-team tutorials retain their original six steps.

Tests use synthetic users in production PostgreSQL transactions that roll back: read/write separation, inventory isolation, both jobs' interleaved saves, same-job conflicts, lost-response replay, non-owner removal of the creator, private grants and ordinary-team regression. Isolated Playwright covers all eight job paths plus keep, tutorials, disabled cross-job controls, confirm-before-switch, member removal, optional stock, restore-outside behavior, test-account repeats and narrow/short viewports. Production smoke testing must not populate the real daily rooms with disposable QA accounts.

Rollback: retain the guarded schema after it has been committed. Restoring unguarded old functions while daily rooms exist would expose protected books. Restore code only if necessary, then forward-fix the client; never blindly restore a pre-release full database over later user writes.

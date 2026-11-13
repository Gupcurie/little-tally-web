# Daily quantity matching and candidate time ranges

The live app and administrator comparison use `dist/reconcile-daily.js`. The original version-1 baseline validator and matcher in `reconcile.js` remain readable for old data; the live comparison no longer uses the baseline start time or a hard 20-item matching window.

## Counting and identity

- Beijing calendar day, midnight through the current read. Only categories with nonzero quantity changes today appear. Opening a comparison at noon includes all morning records.
- Include current ledger and today's closed periods. Repeated record IDs across restored/archived snapshots are deduplicated, with the active snapshot taking precedence. Latest item label for the same ID is used across segments.
- Sum signed changes, cancel reductions against the most recent positive same-category runs, keep negative daily corrections visible. Marked `origin: inherit` opening records are excluded. New segment inheritance writes this marker. Earlier unmarked inheritance/manual `set` records cannot reliably be distinguished retrospectively and are counted as recorded changes; never guess from timestamps.
- Normalize Unicode/whitespace/case. Similar labels are adjacent in the table but remain distinct until a user explicitly merges them. Merge groups can contain multiple names and can be undone without editing business records.
- Front/group aliases are stored in optional `reconciliation.aliases` through the existing CAS save, and retained across new segments. Administrator aliases are per admin identity and directed source pair in the current browser.

## Quantity matching

For each confirmed category, matched quantity is min(nonnegative placed, nonnegative sold). Registration order has no effect on quantity matching. Late sales or reductions recalculate all results. A category surplus in one direction cannot cancel a different category's deficit. Twenty is a global pending reminder threshold, never a matching cutoff.

## Candidate locations

1. Categories with exactly one effective unit on each side provide unambiguous **category/record** anchor pairs; actual physical redemption order is still unknown.
2. Balanced repeated categories with individual-unit records also provide explicitly estimated same-category occurrence references. Their time ranges are labelled estimates and may need widening; these are not asserted physical matches. References are sampled across source progression, capped at 1024, to bound cost.
3. For each surplus category, every effective source record is a possible location. A distinct single remaining occurrence can be identified directly. Repeated categories retain alternatives.
4. For each source location, search all retained reference anchors before and after it. Counterpart positions must occur in the same before/after order. Return the minimum-duration source interval bounded by such a pair, not a fixed minute bucket. Cache per anchor gap. If no compatible bilateral pair exists, show the source record time explicitly as a registration clue, not a falsely precise incident interval.
5. For small repeated categories (<=1600 source units and source-count × other-count <=300000), dynamic programming ranks candidates by best same-category subsequence cost when a unit is left unmatched. Context positions use robust nearby anchor offsets and a soft local disorder allowance. All candidates remain possible even when ranked lower. Larger quantities stay compressed; no unit expansion or unsupported unique-location claim.
6. Display up to 20 ranked source locations per issue, with full candidate count, registration time, source position, possible quantity and both anchor timestamps. Ambiguous records remain explicitly ambiguous. A discrepancy is evidence for checking, not proof of over-placement or missed sales.

## Read path and safety

Personal/group clients use existing checked period-list/read RPCs. Archives are cached per user/workspace/day/current segment; active state changes recalculate immediately. Group comparison stays current via the existing five-second reload while the comparison dialog is open. A manual refresh reloads active state and today's archives; failed/incomplete history reads block a definitive result.

The administrator authenticates the directed account/group pair before reading. `tally_admin_comparison_periods(uuid[])` is an explicit service-only function: PUBLIC/anon/authenticated have no execute grant, no private-table grants are added, and the private period table retains RLS. It returns only sales/egg history from today's closed periods for at most two IDs. The backend filters current and archived records to today's interval before responding. Missing history returns 503, not a partial balanced result.

Opening a comparison causes no automatic ledger save. Only explicit name merges save configuration; business quantities are unchanged. The old "start from now" reset is removed from live comparison. Tutorials now describe the daily/order-independent model.

Focused verification covers the user's seven-placement/six-shuffled-sales example, delayed correction, duplicates/ambiguous locations, brute-force narrowest-anchor oracle across permutations, cross-midnight and future exclusion, archives/deduplication, marked inheritance, signed adjustments, aliases/escaping, compressed large quantities, backend direction/filter/failure, mobile UI and authenticated admin-only SQL checks in a rolled-back production transaction.

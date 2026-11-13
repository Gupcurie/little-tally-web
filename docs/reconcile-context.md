# Reconciliation details and fallback investigation ranges

The matching page polls both the ledger and comparison source. Rebuilding its DOM discarded the native details element's expanded state every few seconds. Rendering now captures open and closed issue keys and the scroll position before replacement, then restores them within the same account/team/day/period/mapping scope. A new scope never inherits another scope's expansion state. Newly appearing issues retain their normal defaults; a disappeared issue's old state cannot open a different ID. This applies to explicit refresh as well as background synchronization.

The original quantity model remains order-independent and unchanged. It still counts today's signed events, excludes explicitly inherited openings, preserves manual many-to-one ID links, and retains multiple candidate records rather than claiming to identify a particular physical egg. Its strongest existing compatible brackets remain preferred and unchanged.

Fallback investigation now has four levels:

- When other categories have both sales and placements but unequal totals or batch registrations, compressed quantity quantiles supply explicitly weak reference pairs. Up to eight representative pairs per category are sampled without expanding large quantities. A compatible pair before and after a candidate yields an estimated interval and shows the other side's reference timestamps. References from the suspect category itself are excluded to avoid circular evidence.
- A single cross-ledger reference gives a one-sided local registration range ending or beginning at the candidate record. The display states that the missing side has no confirmed match and late entry can fall outside this range.
- If neighboring cross-ledger references are reversed in the other ledger, the display reports a local reference range and explains the crossed order. It does not call that range a confirmed pairing.
- With no cross-ledger references, neighboring surviving registration records provide only a registration neighborhood. A lone record still has no defensible additional interval. The display explicitly says that registration time is not necessarily the physical placement/redemption time.

Fallback references are bounded to 256 per issue for interactive use. Estimated intervals are not proofs or guaranteed globally minimal intervals over every possible physical matching. The existing stronger bracket search is preserved. `bounded` keeps its old semantics; weak ranges live in a separate `window` field. Repeated candidates are retained, and the existing interface still shows the first 20 with the total candidate count.

Validation covers partial quantities, balanced bulk entries, one-sided references, crossed order, no shared categories, a lone record, and excluding the suspect category from its own references. Original narrow-bracket, daily-count, shuffle, alias and ID-mapping tests remain passing. Mobile Chrome tests preserve explicit expansion/collapse and scroll over multiple 5-second poll cycles and a manual refresh. A synthetic 4,815-record / 80-category case completed in about 33ms on the development host; that is a smoke check, not a guarantee for all phones.

Only dist/reconcile-daily.js, app.js and sw.js are deployed. The admin imports the same comparison module, so it receives the fallback explanations without an admin container rebuild. No database schema or real ledger records are changed. The service worker is v34-reconcile-context. Deployment backup: /opt/little-tally/ops-backup-reconcile-context-0lftcv46.

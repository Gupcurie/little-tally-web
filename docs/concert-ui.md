# Concert interface release

The production app retains the existing ledger, permissions, recommendation model, reconciliation, saves and action handlers. The approved white / black UI is implemented as a presentation module and stylesheet, with the existing cards and screens.

Only an authenticated member viewing a current Beijing-day daily room receives its `angel` or `devil` background. Ordinary teams and personal books are white, including ordinary teams named 天使大群 or 恶魔大群. Roles and room identity come from existing server-projected workspace metadata, never a name substring, tutorial profile, or a new client permission flag. No database migration is needed.

Product illustration matching is independent of reconciliation and never merges identities or quantities. Uncolored 娃衣 uses the approved red hoodie; uncolored 鼠标垫 uses white. Explicit black labels choose black. Known common aliases, traditional characters and punctuation are accepted. Specific packaging names take priority: 冰箱贴 over 拼图 and 掼蛋 over 纸牌. Unknown names receive no invented icon.

The 12 transparent product illustrations derive from user-supplied merchandise references and approved AI drafts. The selected red hoodie PNG is the exact user selection; black uses the same garment design. The fridge magnet and phone stand retain their complete retail bags; the notes retain the red backing board and white Mars mark. The planter retains its concert lettering and emblem. Production WebP derivatives reduce transfer size; the source preview assets remain separate.

SVG alpha morphology adds a thin black outline in the white theme and white in the dark theme. It outlines the merchandise silhouette, not a rectangle. Cards reserve a separate image region from the number and full-width controls. Uncolored defaults do not depend on the theme. Icons remain visible in personal and ordinary team workspaces.

Desktop uses the same functional navigation as a sidebar, with concert artwork when a daily theme is active. Phone count and placement screens use the available viewport height, three columns for typical 10–11 item catalogs, and scrolling for larger catalogs or constrained screens. Original long press drag, stock parts, bundled sales, copy options, timers, progress and overflow bars remain available. Other pages and dialogs keep the original working data and controls.

Cache: `little-tally-shell-v36-concert-product-ui`, including the two new presentation resources and local product / concert assets. Deployment backs up the changed static files, checks reviewed hashes, stages files and publishes the service worker last. It preserves vendor, cloud configuration, account data and the admin service.

Checks cover the pure theme boundary and alias precedence, related model tests, fixture-authenticated UI in eight sizes, real touch / mouse drag persistence, original save handlers, role switching, matching / statistics / settings, and offline resources. Production verification uses a temporary personal QA account and never joins or changes real daily groups.

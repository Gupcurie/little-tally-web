# Daily job selection and tutorials

Signed-in users choose a job on their first visit each Beijing calendar day. New accounts have no prior choice and see the same selector after registration/login. The selector offers beginner and experienced paths for each job:

- Dismantle: sales and stock on, egg placement off; land on sales.
- Place: egg placement on, sales and stock off; land on egg placement.
- Beginner: six job-specific tutorial steps, back/next/skip; return to job landing page on finish.
- Experienced: apply the same job defaults and enter directly.

Account `123` is the tutorial test exception: every fresh page load or login presents all four choices (two beginner and two experienced), so both the full selector layout and tutorial/skip paths can be reviewed repeatedly. Experienced choices skip the tutorial for that visit; the next page load still asks again. This flag uses the verified account username and grants no permissions.

Preferences are stored under authenticated Auth user metadata `tally_onboarding`, with a per-user local mirror `little-tally-onboarding:<user id>`. Metadata is display configuration only, never used for authorization. Job selection uses `auth.updateUser({data: ...})` and does not save a business ledger or alter group members' preferences. No schema/permission changes. Existing unrelated metadata is retained by Auth. Server-confirmed preferences are loaded on login, including fresh browsers. Failed preference writes leave the choice open with a retry message.

Profile version 1 contains Beijing day, job, enabled books, tutorial-pending marker and update timestamp. Manual book settings persist for that account until another explicit job selection; refreshing does not reapply job defaults. An unfinished beginner tutorial resumes from the first step. Ongoing sessions are not interrupted at midnight; the next page load/login on a new day asks again.

Both tutorials end with a reminder to reopen the tutorial in Settings and user-supplied support contacts: WeChat L2385434375 or SMS 13480041761. Settings contains switch-job and review-tutorial actions. Switching jobs is blocked while a bundle draft or ledger save is active. Switching/showing tutorials preserves business quantities, history, binding configuration, group membership and current workspace. Local demo mode has manual tutorial access but no automatic daily prompt.

Verification: `node --test tests/onboarding.test.mjs tests/cloud.test.mjs`; isolated Playwright full 12-step flows, back/skip, rejection, daily change, fresh-browser preferences, test-account repeats and 280–900px/short-screen layouts; live authenticated QA user confirms metadata update and login persistence, then is deleted. User 123 and real ledgers are not altered for tests. SW cache version is `little-tally-shell-v28-tutorial-help`.

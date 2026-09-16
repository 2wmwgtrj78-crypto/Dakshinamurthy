## 7.5.0 — Storage resilience verified and pinned (2026-09-15)

Continuing the state-enumeration review into the last two data-safety paths:
storage exhaustion and interrupted sessions.

**Nothing was wrong.** Audited and found already correct:

- Storage full: the app shows its save warning, keeps rendering, and does not
  shrink or clear the state already on disk. No uncaught errors. It resumes
  saving and clears the warning once space frees up.
- Corrupt primary state: recovers real state on next load, not a blank one.
- Corrupt primary AND `:last`: still recovers, through the 3-deep recovery ring,
  which is confirmed to fill across successive saves.
- Interrupted session (reload mid-answer): logged misses and scores survive.

**New: `tests/resilience.test.js`** (16 checks, `npm run test:resilience`,
wired into `test:all`). This behaviour is invisible in normal use — you find
out it has broken on the day a phone runs out of space with months of answers
on it. No other suite touched any of it. Control-verified: suppressing the save
warning fails the suite.

Two "findings" in the original audit were defects in the probe, not the app: it
read the wrong localStorage key ('sm8' instead of the real 'surgimaster:v10'),
and tried to trigger a save with a control that was not on screen at the time.
The shipped test derives the key from what the app actually wrote and asserts
the save control exists before depending on it, so neither mistake can recur.

Seven suites.


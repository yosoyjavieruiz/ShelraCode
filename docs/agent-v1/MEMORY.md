# Memory and compaction boundary

The active task ledger is authoritative for the current objective, criteria,
changed files, evidence, verification runs, blockers, and next stage.
Compaction retains the initial objective/context anchor and the latest
observation, plus a compact state summary. Raw tool output remains outside the
model context and can be reacquired from the workspace.

Persistent application state must remain local by default and must not store
credentials, `.env` contents, arbitrary full transcripts, or raw secret-bearing
command output. Older memory never silently outranks fresh workspace evidence.

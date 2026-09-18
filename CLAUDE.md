Read and follow the instructions in AGENTS.md.

Testing: cover behavior that matters (rules, refusals, contracts, auth, data
loss), not trivial details. Cost must match risk. Do not add or keep automated
tests for simple visual changes (color, spacing, copy, icons, layout tweaks);
validate those with `playwright-cli` instead. Run the smallest test that proves
the change; full suites belong to merge and release. The complete policy is in
AGENTS.md.

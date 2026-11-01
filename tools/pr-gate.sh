#!/usr/bin/env bash
# Pre-merge gate (handbook 01, stage 7). Usage: tools/pr-gate.sh <pr-number>
# Checks the PR head on GitHub, never the local checkout. Exit 0 = merge the printed SHA.
set -euo pipefail

pr="${1:?usage: tools/pr-gate.sh <pr-number>}"
fail=0
say() { printf '%s %s\n' "$1" "$2"; }
ok() { say "ok  " "$1"; }
bad() { say "FAIL" "$1"; fail=1; }

json="$(gh pr view "$pr" --json number,title,headRefName,headRefOid,body,isDraft,mergeable,files,commits,statusCheckRollup)"
sha="$(jq -r .headRefOid <<<"$json")"
branch="$(jq -r .headRefName <<<"$json")"
title="$(jq -r .title <<<"$json")"
body="$(jq -r .body <<<"$json")"
echo "PR #$pr  $title"
echo "head  $branch @ $sha"

# 1. Not a draft.
[[ "$(jq -r .isDraft <<<"$json")" == "false" ]] && ok "not a draft" || bad "still a draft"

# 2. PR body has the four template headings.
for h in "## What" "## How verified" "## Merge danger" "## Skipped / not checked"; do
  grep -qF "$h" <<<"$body" && ok "body has '$h'" || bad "body missing '$h'"
done

# 3. Every check on the head is green (no pending, no failure).
pending="$(jq -r '[.statusCheckRollup[]? | select(.status != "COMPLETED" and .state != "SUCCESS")] | length' <<<"$json")"
failed="$(jq -r '[.statusCheckRollup[]? | select((.conclusion // .state) as $c | $c != null and $c != "SUCCESS" and $c != "NEUTRAL" and $c != "SKIPPED" and $c != "" )] | length' <<<"$json")"
total="$(jq -r '.statusCheckRollup | length' <<<"$json")"
if [[ "$total" == "0" ]]; then bad "no checks reported on the head"; 
elif [[ "$failed" != "0" ]]; then bad "$failed check(s) not successful"; 
elif [[ "$pending" != "0" ]]; then bad "$pending check(s) still running"; 
else ok "$total checks green"; fi

# 4. Order PRs: head carries implementation commits beyond the plan (lesson of PR #29).
files="$(jq -r '.files[].path' <<<"$json")"
if [[ "$branch" =~ ^feat/([A-Z]+-[0-9]+) ]]; then
  order="${BASH_REMATCH[1]}"
  plan="docs/orders/$order/plan.md"
  nonplan="$(grep -vc "^docs/orders/$order/" <<<"$files" || true)"
  [[ "$nonplan" -gt 0 ]] && ok "$nonplan file(s) beyond the plan directory" || bad "head changes only $plan; implementation not pushed"
  planbody="$(gh api "repos/{owner}/{repo}/contents/$plan?ref=$sha" --jq .content 2>/dev/null | base64 -d || true)"
  if [[ -z "$planbody" ]]; then bad "$plan not found on head"; else
    grep -qE '^## 8\.' <<<"$planbody" && ok "plan §8 executor notes present" || bad "plan §8 executor notes missing"
    if grep -qiE '^\- \*\*Adversary:\*\* yes' <<<"$planbody" || grep -qiE 'Adversary:\*\* yes' <<<"$planbody"; then
      grep -qE '^## 9\.' <<<"$planbody" && grep -qiE 'PASS|no critical or high' <<<"$planbody" \
        && ok "plan §9 adversary record present" || bad "adversary required but §9 verdict missing"
    else ok "adversary not required by the plan"; fi
  fi
fi

# 5. User-visible change needs an Arabic release note (AGENTS.md workflow 6). A purely technical
#    change under the app source trees (a type import, an architecture rule, a build setting) says so
#    with a body line starting 'Release note: none' followed by the reason.
if grep -qE '^apps/(web|driver|admin)/(app|src)/' <<<"$files"; then
  if grep -qE '^docs/release-notes/[0-9]{4}-[0-9]{2}-[0-9]{2}-.+\.md$' <<<"$files"; then ok "release note present";
  elif grep -qiE '^Release note: none' <<<"$body"; then ok "app source changed; body says Release note: none (reason given)";
  else bad "apps/web, apps/admin or apps/driver source changed without docs/release-notes/ entry and no 'Release note: none <reason>' line in the body"; fi
fi

# 6. Memory upkeep: a change to a trigger path needs a memory update or an explicit waiver.
triggers='^(package\.json|apps/[^/]+/package\.json|packages/[^/]+/package\.json|tools/|\.github/workflows/|AGENTS\.md|docs/handbook/|dependency-cruiser\.shared\.cjs|packages/config-eslint/|packages/config-ts/|apps/api/src/modules/[^/]+/[^/]+\.module\.ts)'
if grep -qE "$triggers" <<<"$files"; then
  if grep -qE '^\.serena/memories/' <<<"$files"; then ok "memory trigger path changed and .serena/memories/ updated";
  elif grep -qiE '^Memories: unchanged' <<<"$body"; then ok "memory trigger path changed; body says Memories: unchanged";
  else bad "trigger path changed (scripts, tools, CI, handbook, lint config or a module) but no .serena/memories/ change and no 'Memories: unchanged' line in the body"; fi
fi

# 6b. Scope (owner request 2026-11-01): a docs-only PR skips the build and test lanes in CI, so
# check the skip was right. Same classifier as CI (tools/changed-scope.sh). A code PR needs every
# required lane green, never skipped; a docs PR still needs typecheck-lint (Prettier) and gitleaks.
scope="$(printf '%s\n' "$files" | "$(dirname "$0")/changed-scope.sh")"
[[ "$scope" == "docs" ]] && say "    " "docs-only: yes" || say "    " "docs-only: no"
required=(typecheck-lint api-test api-test-rls web-build-census admin-build-census driver-test gitleaks)
[[ "$scope" == "docs" ]] && required=(typecheck-lint gitleaks)
for check in "${required[@]}"; do
  conclusion="$(jq -r --arg n "$check" '[.statusCheckRollup[]? | select((.name // .context) == $n) | (if ((.conclusion // "") | length) > 0 then .conclusion else (.status // .state // "PENDING") end)] | first // "MISSING"' <<<"$json")"
  [[ "$conclusion" == "SUCCESS" ]] && ok "required '$check' green" || bad "required '$check' is $conclusion"
done

# 7. Mergeable.
[[ "$(jq -r .mergeable <<<"$json")" == "MERGEABLE" ]] && ok "mergeable" || bad "not mergeable (conflicts or unknown)"

echo
if [[ $fail -eq 0 ]]; then echo "GATE PASS  merge $sha"; else echo "GATE FAIL  do not merge"; exit 1; fi

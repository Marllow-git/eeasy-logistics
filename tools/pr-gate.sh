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

# 5. User-visible change needs an Arabic release note.
if grep -qE '^apps/(web|driver)/(app|src)/' <<<"$files"; then
  grep -qE '^docs/release-notes/[0-9]{4}-[0-9]{2}-[0-9]{2}-.+\.md$' <<<"$files" \
    && ok "release note present" || bad "apps/web or apps/driver UI changed without docs/release-notes/ entry"
fi

# 6. Mergeable.
[[ "$(jq -r .mergeable <<<"$json")" == "MERGEABLE" ]] && ok "mergeable" || bad "not mergeable (conflicts or unknown)"

echo
if [[ $fail -eq 0 ]]; then echo "GATE PASS  merge $sha"; else echo "GATE FAIL  do not merge"; exit 1; fi

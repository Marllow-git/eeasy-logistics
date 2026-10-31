# 02 · Definition of done

A change is done when every line below is true. Reviewers reject a PR that claims done while one is false.

## Any PR

- [ ] The plan-file items it claims are fully delivered: every caller, test, fixture, config key and i18n key touched.
- [ ] CI is green on every check.
- [ ] The PR description follows the template and names the ADRs it relies on.
- [ ] Merge danger and blast radius are stated.
- [ ] Skipped or unchecked items are listed.

## Behaviour change (API or app)

- [ ] A test fails without the change and passes with it (red then green, shown in the PR).
- [ ] Integration tests ran against a real PostgreSQL, not a mock.
- [ ] Error paths return the typed error model with a stable code.
- [ ] Idempotency is honoured where the contract requires it.
- [ ] Tenancy test still passes (no operational table without `account_id`).

## UI change (web or driver app)

- [ ] Every new string has `ar` and `en` keys.
- [ ] Playwright census ran in both locales on an isolated stack; count reported.
- [ ] Right-to-left layout reviewed in the Arabic screenshot.
- [ ] Arabic release note under `docs/release-notes/`.

## Schema change

- [ ] Migration is reviewed SQL; destructive steps are in a separate PR with a backfill plan.
- [ ] Ledger tables keep their append-only triggers.
- [ ] Merge danger says one-way door.

## Security-relevant change

- [ ] Adversary review ran once; critical and high findings fixed in the same PR; medium and low either fixed or ruled with the reason in the PR.

## Documentation change

- [ ] The index that lists the document (`docs/README.md`, `adr/README.md`) is updated in the same PR.

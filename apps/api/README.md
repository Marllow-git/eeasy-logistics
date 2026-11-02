# apps/api

The NestJS API. The repository README covers the stack, the request pipeline and each kernel area; this file covers the process roles OPS-1 runs.

## Process roles

One image, one entry point (`node dist/main.js --role <role>`):

| Role            | Runs                                                | Database credential                         |
| --------------- | --------------------------------------------------- | ------------------------------------------- |
| `api` (default) | the HTTP server                                     | `DATABASE_URL_APP`, `DATABASE_URL_PLATFORM` |
| `worker`        | outbox relay and queues, the hourly purges, gauges  | `DATABASE_URL_APP`, `DATABASE_URL_PLATFORM` |
| `migrate`       | the one-shot migration job and the audit partitions | `DATABASE_URL_OWNER` only                   |
| `bootstrap`     | the first platform super admin's invitation (below) | `DATABASE_URL_PLATFORM` only                |

## Bootstrap: the first super admin

Platform staff are invited by a super admin (identity and tenancy §3.3). The first one is created once per environment, without a seed row, a password in an environment variable or anyone editing the database (PLAT-11 plan 2.12, owner question 5):

```sh
node dist/main.js --role bootstrap --email owner@example.com --name "Owner Name" [--locale ar|en]
```

- It needs `DATABASE_URL_PLATFORM` and `PUBLIC_ADMIN_URL` (production refuses to start without them) and nothing else: no SMTP, no Redis, no owner URL (refused in staging and production, ADR-0031).
- It refuses (exit 1) when any `core_platform_staff` row exists, a `super_admin` invitation is still open, or the email belongs to a disabled user (such a link could never be accepted); runs are serialised by an advisory lock.
- Otherwise it creates a platform invitation for role `super_admin`, valid 72 hours, prints the console link (`PUBLIC_ADMIN_URL/invitations/<token>`) once on stdout, sends no mail, and writes the audit row `core.platform_staff.bootstrapped` (actor `system`). Exit 0.
- Bad or missing arguments exit 64 with the usage line.
- The link is a credential: run the command in a session whose output is not collected by the log pipeline, open the link, set the password, then enrol TOTP in the console (`platformAcceptInvitation`, `platformEnrolTotp`, `platformConfirmTotp`). If the link expires unused, run the command again.

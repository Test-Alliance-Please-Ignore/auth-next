# corporation-tax

Cloudflare Worker with Corporation Tax Durable Object.

## Development

```bash
# Start development server
just dev -F corporation-tax

# Run tests
pnpm -F corporation-tax test

# Deploy
just deploy -F corporation-tax
```

## Database

```bash
# Generate migrations
just db-generate corporation-tax

# Run migrations
just db-migrate corporation-tax
```

## Current UI Map

The current tax UI is routed from the main app and uses three feature URNs plus
corporation self-service resolution:

- `urn:tax:viewer`: read access for member-summary style views within the user's corporation scope
- `urn:tax:auditor`: read access to reports, exports, and billing visibility
- `urn:tax:admin`: full tax access, including settings, alerts, ledger, billing operations, and audit log
- `site admin`: full access everywhere
- `CEO/director self-service`: read access for their own corporation where supported

Current route inventory:

| Route | Page | Function | Access |
| --- | --- | --- | --- |
| `/tax` | Redirect | Redirects to member summary | Same access as `/tax/member-summary` |
| `/tax/member-summary` | Tax Member Summary | Member-level tax due, paid, delta, compliance status, and top taxable income sources | Site admin, `urn:tax:admin`, `urn:tax:auditor`, `urn:tax:viewer` with corporation membership, CEO/director self-service for own corporation |
| `/tax/reports` | Tax Reports | Summary KPIs, total taxes by corporation, top income sources, ESS payout reporting, compliance trends, discrepancies, missing ESI keys, excluded corporations, exports, and export schedules | Site admin, `urn:tax:admin`, `urn:tax:auditor` |
| `/tax/bills` | Tax Billing | Bill status rollups, bill history, assessment list, bill creation, bill issuance, and bill status sync | View: site admin, `urn:tax:admin`, `urn:tax:auditor`; mutate: site admin, `urn:tax:admin` |
| `/tax/alerts` | Tax Alerts | Alert inbox, severity/status filtering, acknowledge/resolve actions, and Discord delivery telemetry | View/manage: site admin, `urn:tax:admin`; failed-delivery retry and delivery telemetry are site-admin only |
| `/tax/ledger` | Tax Ledger | Normalized ledger explorer over corporation and character wallet data with detailed filters | Site admin, `urn:tax:admin` |
| `/tax/settings` | Tax Settings | Corporation inclusion, rates, rule sets, billing defaults, member-summary toggle, and Discord notification destination overrides | Site admin, `urn:tax:admin` |
| `/tax/audit-log` | Tax Audit Log | Review configuration and operational audit entries | Site admin, `urn:tax:admin` |

## Current Navigation Matrix

The current sidebar is more restrictive than some direct-route access:

| Page | Viewer | Auditor | Admin | CEO/Director Self-Service |
| --- | --- | --- | --- | --- |
| Member Summary | Yes | Yes | Yes | Yes |
| Reports | No | Yes | Yes | No |
| Billing | No | Yes | Yes | No |
| Alerts | No | No | Yes | No |
| Ledger | No | No | Yes | No |
| Settings | No | No | Yes | No |
| Audit Log | No | No | Yes | No |

Known current-state notes:

- Backend member-summary access also supports limited corporation-member self-read when member summary is enabled for that corporation, but the current UI primarily optimizes for viewer/auditor/admin and CEO/director access flows.

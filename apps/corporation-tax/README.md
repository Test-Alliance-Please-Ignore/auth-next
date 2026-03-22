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

### Migration Notes

- `drizzle.config.ts` intentionally points at `src/db/schema.migrations.ts` (migration-owned objects only).
- Runtime reads can still use external/core-owned tables from `src/db/schema.ts` (for example `managed_corporations`), but those must not be part of generated migration DDL.

## Current UI Map

The current tax UI is routed from the main app and uses three feature URNs plus
corporation self-service resolution:

- `urn:corps:<eve-corp-id>:tax:viewer`: scoped read access for member-summary style views (still requires corporation membership)
- `CEO/director`: read access for corporations where the user is a CEO/director (viewer-equivalent scope where supported)
- `urn:tax:auditor`: read access to reports, exports, and billing visibility
- `urn:tax:admin`: full tax access, including settings, alerts, ledger, billing operations, and audit log
- `site admin`: full access everywhere

Current route inventory:

| Route | Page | Function | Access |
| --- | --- | --- | --- |
| `/tax` | Redirect | Redirects to member summary | Same access as `/tax/member-summary` |
| `/tax/member-summary` | Tax Member Summary | Member-level tax due, paid, delta, compliance status, and top taxable income sources | Site admin, `urn:tax:admin`, `urn:tax:auditor`, `urn:corps:<eve-corp-id>:tax:viewer` with corporation membership, CEO/director self-service for own corporation |
| `/tax/reports` | Tax Reports | Summary KPIs, total taxes by corporation, top income sources, ESS payout reporting, compliance trends, discrepancies, missing ESI keys, exports, and export schedules | Site admin, `urn:tax:admin`, `urn:tax:auditor` |
| `/tax/bills` | Tax Billing | Bill status rollups, bill history, assessment list, bill creation, bill issuance, and bill status sync | View: site admin, `urn:tax:admin`, `urn:tax:auditor`; mutate: site admin, `urn:tax:admin` |
| `/tax/alerts` | Tax Alerts | Alert inbox, severity/status filtering, acknowledge/resolve actions, and Discord delivery telemetry | View/manage: site admin, `urn:tax:admin`; failed-delivery retry and delivery telemetry are site-admin only |
| `/tax/ledger` | Tax Ledger | Normalized ledger explorer over corporation and character wallet data with detailed filters | Site admin, `urn:tax:admin` |
| `/tax/rules` | Tax Rules | Rule groups, corporation attachments, and active tax rules used by assessment calculations | Site admin, `urn:tax:admin` |
| `/tax/exclusions` | Tax Exclusions | Standalone corporation exclusion list with reason tracking | Site admin, `urn:tax:admin` |
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
| Rules | No | No | Yes | No |
| Exclusions | No | No | Yes | No |
| Audit Log | No | No | Yes | No |

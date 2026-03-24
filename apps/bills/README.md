# Bills Worker

Complete bills management system for EVE Online corporations, groups, and characters with recurring bill support via Cloudflare Workflows.

## Features

- **Bills Management**: Create, issue, pay, and cancel bills
- **Late Fees**: Configurable static or percentage-based late fees with multiple compounding modes
- **Bill Templates**: Reusable templates with parameter substitution
- **Recurring Bills**: Automated bill generation using Cloudflare Workflows
- **Schedule Management**: Daily, weekly, or monthly recurring bills
- **Secure Payments**: 12-character cryptographically secure payment tokens (fits in EVE wallet reason field)
- **Authorization**: Route-level permissions in `apps/core` with domain-level lifecycle invariants in this worker

## Architecture

### Singleton Durable Object Pattern

This worker uses a singleton Durable Object pattern:

```typescript
import { getStub } from '@repo/do-utils'

import type { Bills } from '@repo/bills'

const stub = getStub<Bills>(env.BILLS, 'default')
const bill = await stub.createBill(userId, billData)
```

### Database

PostgreSQL via Neon serverless with Drizzle ORM:

- **bills**: Main bills table
- **bill_templates**: Reusable templates
- **bill_schedules**: Recurring bill schedules
- **schedule_execution_logs**: Audit trail for schedule execution

### Services

Business logic is separated into service classes:

- **BillService**: Bill lifecycle, late fees, payment processing
- **TemplateService**: Template CRUD, cloning, bill generation
- **ScheduleService**: Schedule management, next run calculation

### Workflows

**BillScheduleExecutorWorkflow**: Executes scheduled bill generation with:

- Exponential backoff retry logic
- Failure tracking and auto-pause after 3 consecutive failures
- Integration with notification system (future)

## Development

### Database Operations

```bash
# Generate migrations from schema changes
just db-generate bills

# Run migrations
just db-migrate bills

# Open Drizzle Studio
just db-studio bills
```

**CRITICAL:** Never use `db:push` - always use migrations!

### Testing

Integration tests use neon-testing for database branching:

```bash
# Run all tests
just test -F bills
# or: pnpm test
```

### Development Server

```bash
# Start development server
just dev -F bills
# or: pnpm dev
```

### Deployment

```bash
# Deploy to Cloudflare
just deploy -F bills
# or: pnpm deploy
```

## API Examples

### Create a Bill

```typescript
const bill = await stub.createBill(userId, {
  payerId: 'character-123',
  payerType: 'character',
  title: 'Monthly Rent',
  description: 'Office space rental',
  amount: '1000000000', // 1 billion ISK
  dueDate: new Date('2025-02-01'),
  lateFeeType: 'percentage',
  lateFeeAmount: '5', // 5% per day
  lateFeeCompounding: 'daily',
})
```

### Issue and Pay a Bill

```typescript
// Issuer issues the bill
await stub.issueBill(userId, bill.id)

// Payer pays using payment token
const result = await stub.payBill(bill.paymentToken)
```

### Create a Template

```typescript
const template = await stub.createTemplate(userId, {
  name: 'Monthly Tax',
  titleTemplate: 'Tax for {month}',
  descriptionTemplate: 'Corporation tax for {month}',
  amountTemplate: '{amount}',
  lateFeeType: 'static',
  lateFeeAmount: '50000000',
  lateFeeCompounding: 'weekly',
  daysUntilDue: 7,
})
```

### Create Recurring Schedule

```typescript
const schedule = await stub.createSchedule(userId, {
  templateId: template.id,
  payerId: 'corporation-456',
  payerType: 'corporation',
  frequency: 'monthly',
  amount: '500000000', // 500M ISK per month
  startDate: new Date('2025-02-01'),
})
```

## Late Fee Calculation

### Static Fees

- **None**: One-time flat fee when overdue
- **Daily**: Fee amount × days overdue
- **Weekly**: Fee amount × weeks overdue
- **Monthly**: Fee amount × months overdue

### Percentage Fees

- **None**: One-time percentage of bill amount
- **Daily**: Percentage × days overdue
- **Weekly**: Percentage × weeks overdue
- **Monthly**: Percentage × months overdue

Example: 1M ISK bill, 5% daily late fee, 3 days overdue:

```
Late Fee = 1,000,000 × 0.05 × 3 = 150,000 ISK
```

## Permission And Action Matrix

This section documents the current user-facing permission model implemented in `apps/core/src/routes/bills-admin.ts` and `apps/core/src/routes/bills-user.ts`.

### Core User-Facing Endpoints

| Endpoint Prefix | Audience | Notes |
|---|---|---|
| `/api/admin/bills/*` | Site admin only (`requireAdmin`) | Full visibility and all bill/template/schedule actions. |
| `/api/bills/my-bills*` | Billing viewers | Allowed for site admins or users with `ROLE_CORE_ALLIANCE_MEMBER`. |

### View Matrix

| Route | Site Admin | Non-Admin Entity Owner / Party |
|---|---|---|
| `GET /api/admin/bills` | ✅ all bills | ❌ |
| `GET /api/admin/bills/:billId` | ✅ all bills | ❌ |
| `GET /api/admin/bills/templates*` | ✅ all templates | ❌ |
| `GET /api/admin/bills/schedules*` | ✅ all schedules | ❌ |
| `GET /api/bills/my-bills` | ✅ (scope = `all`) | ✅ (scope = `my`: issuer + allowed parties) |
| `GET /api/bills/my-bills/:billId` | ✅ (integration-view override) | ✅ if issuer/party-scoped and allowed by draft rule; otherwise `404` |
| `GET /api/bills/my-bills/parties/search` | ✅ (scope = `all`) | ✅ (scope = `my`) |

### Action Matrix

Current state: all user-facing mutation routes are admin-routes.

| Action | Route | Site Admin | Non-Admin Entity Owner |
|---|---|---|---|
| Create bill | `POST /api/admin/bills` | ✅ | ❌ |
| Update bill | `PUT /api/admin/bills/:billId` | ✅ | ❌ |
| Delete bill | `DELETE /api/admin/bills/:billId` | ✅ | ❌ |
| Issue bill | `POST /api/admin/bills/:billId/issue` | ✅ | ❌ |
| Cancel bill | `POST /api/admin/bills/:billId/cancel` | ✅ | ❌ |
| Revert bill to draft | `POST /api/admin/bills/:billId/revert-to-draft` | ✅ | ❌ |
| Regenerate token | `POST /api/admin/bills/:billId/regenerate-token` | ✅ | ❌ |
| Create/update/delete template | `/api/admin/bills/templates*` | ✅ | ❌ |
| Create/update/delete/pause/resume schedule | `/api/admin/bills/schedules*` | ✅ | ❌ |

### Domain Lifecycle Invariants (enforced in Bills worker)

Route permissions do not bypass lifecycle rules in `BillService`.

| Operation | Domain Rule |
|---|---|
| `updateBill` | blocked when bill is `paid` or has any recorded payment |
| `deleteBill` | draft-only |
| `issueBill` | draft-only transition |
| `cancelBill` | blocked when `paid`; no-op protection for already `cancelled` |
| `revertBillToDraft` | blocked when `paid` or has any recorded payment |
| `regeneratePaymentToken` | blocked when `paid`, `cancelled`, or has any recorded payment |
| `payBill` | blocked when `draft`, `cancelled`, or already `paid` |

### Ownership Scope In RPC Contracts

- `owner/all` scope is retained for read/list style methods (e.g. list/get/logs/statistics).
- Mutating RPC methods rely on route-layer authorization and actor attribution; they do not enforce owner-vs-admin permissions in the bills DO layer.

### Current Test Coverage

- `apps/core/src/routes/__tests__/bills-user.scope.test.ts`: my-bills scope/entity matrix.
- `apps/core/src/routes/__tests__/bills-user.route.test.ts`: user-facing read access matrix + site-admin override on my-bills routes.
- `apps/core/src/routes/__tests__/bills-admin.route.test.ts`: admin action access matrix across bills/templates/schedules with non-admin denial.

## Environment Variables

Required in `.env` or wrangler secrets:

```bash
# Database connection (migrations)
DATABASE_URL_MIGRATIONS=postgres://...

# Database connection (worker)
DATABASE_URL=postgres://...
```

## Type Safety

Full type safety via shared `@repo/bills` package:

```typescript
import type {
  Bill,
  Bills,
  BillSchedule,
  BillTemplate,
  CreateBillInput,
  CreateScheduleInput,
  CreateTemplateInput,
} from '@repo/bills'
```

## Using from Other Workers

1. Add the binding to `wrangler.jsonc`:

```jsonc
{
  "durable_objects": {
    "bindings": [
      {
        "name": "BILLS",
        "class_name": "Bills",
        "script_name": "bills",
      },
    ],
  },
}
```

2. Add the dependency:

```bash
pnpm -F your-worker add '@repo/bills@workspace:*'
pnpm -F your-worker add '@repo/do-utils@workspace:*'
```

3. Use it:

```typescript
import { getStub } from '@repo/do-utils'

import type { Bills } from '@repo/bills'

const stub = getStub<Bills>(env.BILLS, 'default')
const bills = await stub.listBills(userId)
```

## Future Enhancements

- [ ] Notification integration for bill events
- [ ] Bulk bill operations
- [ ] Bill attachments/receipts
- [ ] Payment history tracking
- [ ] Multi-currency support
- [ ] Partial payments
- [ ] Payment plans
- [ ] Bill disputes/refunds

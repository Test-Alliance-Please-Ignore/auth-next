# Bills Worker

Complete bills management system for EVE Online corporations, groups, and characters with recurring bill support via Cloudflare Workflows.

## Features

- **Bills Management**: Create, issue, pay, and cancel bills
- **Late Fees**: Configurable static or percentage-based late fees with multiple compounding modes
- **Bill Templates**: Reusable templates with parameter substitution
- **Recurring Bills**: Automated bill generation using Cloudflare Workflows
- **Schedule Management**: Daily, weekly, or monthly recurring bills
- **Secure Payments**: 32-byte cryptographically secure payment tokens
- **Authorization**: Role-based access control (issuer vs. payer permissions)

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
  lateFeeCompounding: 'daily'
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
  daysUntilDue: 7
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
  startDate: new Date('2025-02-01')
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

## Authorization Model

### Bill Operations

- **Create**: Any user
- **Update/Delete**: Issuer only, draft status only
- **Issue/Cancel**: Issuer only
- **View**: Issuer or payer
- **Pay**: Anyone with payment token

### Template Operations

- **Create/Update/Delete**: Owner only
- **View/Clone**: Owner only
- **Use**: Owner only

### Schedule Operations

- **All operations**: Owner only

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
  Bills,
  Bill,
  BillTemplate,
  BillSchedule,
  CreateBillInput,
  CreateTemplateInput,
  CreateScheduleInput
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
        "script_name": "bills"
      }
    ]
  }
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

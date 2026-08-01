import { randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from '@neondatabase/serverless'
import { config } from 'dotenv'

const PAYMENT_LOOKBEHIND_MS = 60 * 60 * 1000
const MAX_CANDIDATES = 25

type QueryRow = Record<string, unknown>

type Options = {
	billId: string
	journalId?: string
	json: boolean
}

function parseOptions(args: string[]): Options {
	if (args.includes('--help') || args.includes('-h')) {
		console.log(`Usage: pnpm -F bills diagnose:payment-insert -- <bill-id> [options]

Runs the bill payment CTE inside a transaction that is always rolled back.

Options:
  --journal-id <id>  Test a specific wallet journal ID instead of the first candidate
  --json             Print machine-readable output
  --help             Show this help text`)
		process.exit(0)
	}

	const positional = args.filter((argument) => !argument.startsWith('--'))
	const billId = positional[0]
	if (!billId) {
		throw new Error('A bill ID is required. Use --help for usage.')
	}

	const journalIdIndex = args.indexOf('--journal-id')
	const journalId = journalIdIndex >= 0 ? args[journalIdIndex + 1] : undefined
	if (journalIdIndex >= 0 && !journalId) {
		throw new Error('--journal-id requires a value')
	}

	return {
		billId,
		journalId,
		json: args.includes('--json'),
	}
}

function serializeError(error: unknown): Record<string, unknown> {
	if (!error || typeof error !== 'object') {
		return { message: String(error) }
	}

	const source = error as Record<string, unknown>
	return {
		name: source.name,
		message: source.message,
		code: source.code,
		detail: source.detail,
		hint: source.hint,
		position: source.position,
		table: source.table,
		column: source.column,
		constraint: source.constraint,
		stack: source.stack,
	}
}

function toDate(value: unknown, label: string): Date {
	const date = value instanceof Date ? value : new Date(String(value))
	if (Number.isNaN(date.getTime())) {
		throw new Error(`Invalid ${label}: ${String(value)}`)
	}
	return date
}

function getPaymentSearchStart(bill: QueryRow): Date {
	const paymentStartAt = toDate(bill.issued_at ?? bill.created_at, 'payment start date')
	const lastCheckedRaw = bill.payment_last_checked_at
	const lastCheckedAt = lastCheckedRaw
		? toDate(lastCheckedRaw, 'payment last checked date').getTime() - PAYMENT_LOOKBEHIND_MS
		: paymentStartAt.getTime()

	return new Date(Math.max(paymentStartAt.getTime(), lastCheckedAt))
}

async function querySchemaMetadata(client: {
	query: (text: string, values?: unknown[]) => Promise<{ rows: QueryRow[] }>
}) {
	const [
		entityTypes,
		eventTypes,
		paymentIndexes,
		eventIndexes,
		paymentConstraints,
		eventConstraints,
	] = await Promise.all([
		client.query(`
				select enumlabel as value
				from pg_enum
				join pg_type on pg_type.oid = pg_enum.enumtypid
				where pg_type.typname = 'bill_entity_type'
				order by enumsortorder
			`),
		client.query(`
				select enumlabel as value
				from pg_enum
				join pg_type on pg_type.oid = pg_enum.enumtypid
				where pg_type.typname = 'bill_status_event_type'
				order by enumsortorder
			`),
		client.query(`
				select indexname, indexdef
				from pg_indexes
				where schemaname = current_schema()
					and tablename = 'bill_payments'
				order by indexname
			`),
		client.query(`
				select indexname, indexdef
				from pg_indexes
				where schemaname = current_schema()
					and tablename = 'bill_status_events'
				order by indexname
			`),
		client.query(`
				select conname, pg_get_constraintdef(oid) as definition
				from pg_constraint
				where conrelid = 'bill_payments'::regclass
				order by conname
			`),
		client.query(`
				select conname, pg_get_constraintdef(oid) as definition
				from pg_constraint
				where conrelid = 'bill_status_events'::regclass
				order by conname
			`),
	])

	return {
		entityTypes: entityTypes.rows,
		eventTypes: eventTypes.rows,
		paymentIndexes: paymentIndexes.rows,
		eventIndexes: eventIndexes.rows,
		paymentConstraints: paymentConstraints.rows,
		eventConstraints: eventConstraints.rows,
	}
}

async function main(): Promise<void> {
	const options = parseOptions(process.argv.slice(2))
	const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
	config({ path: resolve(rootDir, '.env') })

	const databaseUrl = process.env.DATABASE_URL
	if (!databaseUrl) {
		throw new Error('DATABASE_URL is required in the root .env or process environment')
	}

	const pool = new Pool({ connectionString: databaseUrl, max: 1 })
	const client = await pool.connect()
	let output: Record<string, unknown>
	let exitCode = 0

	try {
		const billResult = await client.query(
			`
			select
				b.id,
				b.status,
				b.payee_id,
				b.payee_type,
				b.payment_token,
				b.created_at,
				b.payment_last_checked_at,
				issued.created_at as issued_at
			from bills b
			left join lateral (
				select created_at
				from bill_status_events
				where bill_id = b.id
					and event_type = 'issued'::bill_status_event_type
				order by created_at desc
				limit 1
			) issued on true
			where b.id = $1::uuid
		`,
			[options.billId]
		)

		const bill = billResult.rows[0]
		if (!bill) {
			throw new Error(`Bill not found: ${options.billId}`)
		}

		const paymentSearchStart = getPaymentSearchStart(bill)
		const searchEnd = new Date()
		const candidateTable =
			bill.payee_type === 'corporation'
				? 'corporation_wallet_journal'
				: bill.payee_type === 'character'
					? 'character_wallet_journal'
					: null

		const baseResult = {
			bill: {
				id: bill.id,
				status: bill.status,
				payeeId: bill.payee_id,
				payeeType: bill.payee_type,
				paymentToken: bill.payment_token,
				paymentStartAt: paymentSearchStart.toISOString(),
				paymentLastCheckedAt: bill.payment_last_checked_at,
			},
			searchEnd: searchEnd.toISOString(),
		}

		if (!candidateTable || !bill.payee_id) {
			output = {
				...baseResult,
				status: 'not-testable',
				reason: 'Bill has no supported payee type and ID for wallet journal lookup',
			}
		} else {
			const ownerColumn = bill.payee_type === 'corporation' ? 'corporation_id' : 'character_id'
			const candidateResult = await client.query(
				`select
					journal_id::text as journal_id,
					amount::text as amount,
					first_party_id::text as first_party_id,
					date,
					reason
				from ${candidateTable}
				where ${ownerColumn} = $1
					and date >= $2
					and date <= $3
					and reason is not null
					and reason like $4
				order by date asc, journal_id asc
				limit ${MAX_CANDIDATES}`,
				[bill.payee_id, paymentSearchStart, searchEnd, `${bill.payment_token}%`]
			)

			const selectedCandidate = options.journalId
				? candidateResult.rows.find((row) => row.journal_id === options.journalId)
				: candidateResult.rows.find((row) => row.first_party_id !== null && Number(row.amount) > 0)
			if (!selectedCandidate) {
				output = {
					...baseResult,
					status: 'no-candidate',
					candidateCount: candidateResult.rows.length,
					candidates: candidateResult.rows,
					reason: options.journalId
						? 'Requested journal ID was not found in the bill payment window'
						: 'No positive wallet journal candidate with a payer ID was found',
				}
			} else {
				const existingResult = await client.query(
					`select bill_id, amount, paid_by_id, paid_by_type, paid_at
					 from bill_payments
					 where esi_transaction_id = $1
					 limit 1`,
					[selectedCandidate.journal_id]
				)

				const metadata = await querySchemaMetadata(client)
				await client.query('begin')
				try {
					const reproductionResult = await client.query(
						`with payment_input (
							payment_id,
							event_id,
							bill_id,
							payment_token,
							esi_transaction_id,
							amount,
							paid_by_id,
							paid_by_type,
							paid_at
						) as (
							values (
								$1::uuid,
								$2::uuid,
								$3::uuid,
								$4,
								$5,
								$6,
								$7,
								$8::bill_entity_type,
								$9::timestamptz
							)
						), inserted_payments as (
							insert into bill_payments (
								id,
								bill_id,
								payment_token,
								esi_transaction_id,
								amount,
								paid_by_id,
								paid_by_type,
								paid_at
							)
							select
								payment_id,
								bill_id,
								payment_token,
								esi_transaction_id,
								amount,
								paid_by_id,
								paid_by_type,
								paid_at
							from payment_input
							on conflict (esi_transaction_id) do nothing
							returning bill_id, esi_transaction_id, amount, paid_by_id, paid_by_type
						), inserted_events as (
							insert into bill_status_events (
								id,
								bill_id,
								event_type,
								from_status,
								to_status,
								actor_user_id,
								metadata
							)
							select
								payment_input.event_id,
								inserted_payments.bill_id,
								'payment_recorded'::bill_status_event_type,
								null::bill_status,
								null::bill_status,
								null,
								jsonb_build_object(
									'amount', inserted_payments.amount,
									'paidById', inserted_payments.paid_by_id,
									'paidByType', inserted_payments.paid_by_type,
									'esiTransactionId', inserted_payments.esi_transaction_id
								)
							from inserted_payments
							inner join payment_input
								on payment_input.bill_id = inserted_payments.bill_id
								and payment_input.esi_transaction_id = inserted_payments.esi_transaction_id
							returning id
						)
						select
							(select count(*)::int from inserted_payments) as inserted_count,
							(select count(*)::int from inserted_events) as inserted_event_count`,
						[
							randomUUID(),
							randomUUID(),
							bill.id,
							bill.payment_token,
							selectedCandidate.journal_id,
							selectedCandidate.amount,
							selectedCandidate.first_party_id,
							bill.payee_type,
							new Date(),
						]
					)

					output = {
						...baseResult,
						status: 'reproduced',
						candidateCount: candidateResult.rows.length,
						candidate: selectedCandidate,
						existingPayment: existingResult.rows[0] ?? null,
						reproduction: reproductionResult.rows[0] ?? null,
						metadata,
					}
				} catch (error) {
					output = {
						...baseResult,
						status: 'failed',
						candidateCount: candidateResult.rows.length,
						candidate: selectedCandidate,
						existingPayment: existingResult.rows[0] ?? null,
						metadata,
						error: serializeError(error),
					}
					exitCode = 1
				} finally {
					await client.query('rollback')
				}
			}
		}
	} finally {
		client.release()
		await pool.end()
	}

	if (options.json) {
		console.log(JSON.stringify(output, null, 2))
	} else {
		console.log(`Diagnostic status: ${output.status}`)
		console.log(JSON.stringify(output, null, 2))
	}

	process.exitCode = exitCode
}

main().catch((error) => {
	console.error('Payment insert diagnostic failed:', serializeError(error))
	process.exitCode = 1
})

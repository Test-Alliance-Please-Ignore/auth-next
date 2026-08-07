import { describe, expect, it } from 'vitest'

import { toErrorLogDetails } from './errors'

describe('toErrorLogDetails', () => {
	it('extracts database diagnostics and redacts sensitive query parameters', () => {
		const cause = Object.assign(new Error('connection reset by peer'), {
			code: 'ECONNRESET',
			detail: 'upstream connection closed',
		})
		const error = Object.assign(
			new Error(
				'Failed query: update users set access_token = $1 where id = $2\nparams: secret, user-1'
			),
			{
				query: 'update users set access_token = $1 where id = $2',
				params: ['secret', 'user-1'],
				cause,
			}
		)

		expect(toErrorLogDetails(error)).toMatchObject({
			message: 'Failed query: update users set access_token = $1 where id = $2',
			query: 'update users set access_token = $1 where id = $2',
			paramsCount: 2,
			parameterColumns: ['access_token', 'id'],
			parameterValues: ['<redacted>', 'user-1'],
			cause: 'connection reset by peer',
			causeCode: 'ECONNRESET',
			causeDetail: 'upstream connection closed',
		})
		expect(toErrorLogDetails(error).message).not.toContain('secret')
	})

	it('keeps payment, SRP, and fleet tokens visible while bounding long text', () => {
		const longReason = 'reason '.repeat(200)
		const error = Object.assign(
			new Error(
				'Failed query: insert into bill_payments (payment_token, srp_token, token, reason) values ($1, $2, $3, $4)'
			),
			{
				query:
					'insert into bill_payments (payment_token, srp_token, token, reason) values ($1, $2, $3, $4)',
				params: ['payment-token', 'srp-token', 'fleet-token', longReason],
			}
		)

		expect(toErrorLogDetails(error)).toMatchObject({
			parameterColumns: ['payment_token', 'srp_token', 'token', 'reason'],
			parameterValues: [
				'payment-token',
				'srp-token',
				'fleet-token',
				`${longReason.slice(0, 1_000)}...[truncated]`,
			],
		})
	})

	it('extracts driver fields when the database error is not an Error instance', () => {
		expect(
			toErrorLogDetails({
				message: 'database unavailable',
				code: '57P01',
				detail: 'admin shutdown',
			})
		).toMatchObject({
			message: 'database unavailable',
			code: '57P01',
			detail: 'admin shutdown',
		})
	})
})

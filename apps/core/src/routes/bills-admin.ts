/**
 * Bills routes - Administrative operations for managing bills, templates, and schedules
 *
 * All endpoints require authentication and admin privileges.
 * These endpoints call the Bills Durable Object via RPC.
 */

import { Hono } from 'hono'

import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import { requireAdmin, requireAuth } from '../middleware/session'

import type { Bills } from '@repo/bills'
import type { App } from '../context'

const app = new Hono<App>()

// ===== Bill Routes =====

/**
 * GET /bills
 * List bills with optional filters
 */
app.get('/', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const status = c.req.query('status')
		const payerId = c.req.query('payerId')
		const payerType = c.req.query('payerType')
		const issuerId = c.req.query('issuerId')
		const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : undefined
		const offset = c.req.query('offset') ? parseInt(c.req.query('offset')!) : undefined

		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const bills = await stub.listBills(user.id, {
			status: status as any,
			payerId,
			payerType: payerType as any,
			issuerId,
		})

		return c.json(bills)
	} catch (error) {
		logger.error('Error listing bills:', error)
		return c.json({ error: 'Failed to list bills' }, 500)
	}
})

/**
 * GET /bills/:billId
 * Get a specific bill
 */
app.get('/:billId', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const billId = c.req.param('billId')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const bill = await stub.getBill(user.id, billId)

		if (!bill) {
			return c.json({ error: 'Bill not found' }, 404)
		}

		return c.json(bill)
	} catch (error) {
		logger.error('Error getting bill:', error)
		return c.json({ error: 'Failed to get bill' }, 500)
	}
})

/**
 * POST /bills
 * Create a new bill
 */
app.post('/', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const data = await c.req.json()
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const bill = await stub.createBill(user.id, data)

		return c.json(bill, 201)
	} catch (error) {
		logger.error('Error creating bill:', error)
		return c.json({ error: 'Failed to create bill' }, 500)
	}
})

/**
 * PUT /bills/:billId
 * Update a bill
 */
app.put('/:billId', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const billId = c.req.param('billId')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const data = await c.req.json()
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const bill = await stub.updateBill(user.id, billId, data)

		return c.json(bill)
	} catch (error) {
		logger.error('Error updating bill:', error)
		return c.json({ error: 'Failed to update bill' }, 500)
	}
})

/**
 * DELETE /bills/:billId
 * Delete a bill
 */
app.delete('/:billId', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const billId = c.req.param('billId')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		await stub.deleteBill(user.id, billId)

		return c.json({ success: true })
	} catch (error) {
		logger.error('Error deleting bill:', error)
		return c.json({ error: 'Failed to delete bill' }, 500)
	}
})

/**
 * POST /bills/:billId/issue
 * Issue a bill
 */
app.post('/:billId/issue', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const billId = c.req.param('billId')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const bill = await stub.issueBill(user.id, billId)

		return c.json(bill)
	} catch (error) {
		logger.error('Error issuing bill:', error)
		return c.json({ error: 'Failed to issue bill' }, 500)
	}
})

/**
 * POST /bills/:billId/cancel
 * Cancel a bill
 */
app.post('/:billId/cancel', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const billId = c.req.param('billId')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const bill = await stub.cancelBill(user.id, billId)

		return c.json(bill)
	} catch (error) {
		logger.error('Error cancelling bill:', error)
		return c.json({ error: 'Failed to cancel bill' }, 500)
	}
})

/**
 * POST /bills/:billId/regenerate-token
 * Regenerate payment token
 */
app.post('/:billId/regenerate-token', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const billId = c.req.param('billId')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const result = await stub.regeneratePaymentToken(user.id, billId)

		return c.json(result)
	} catch (error) {
		logger.error('Error regenerating token:', error)
		return c.json({ error: 'Failed to regenerate token' }, 500)
	}
})

/**
 * GET /bills/statistics
 * Get bill statistics
 */
app.get('/statistics', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const stats = await stub.getBillStatistics(user.id)

		return c.json(stats)
	} catch (error) {
		logger.error('Error getting bill statistics:', error)
		return c.json({ error: 'Failed to get statistics' }, 500)
	}
})

// ===== Template Routes =====

/**
 * GET /bills/templates
 * List templates
 */
app.get('/templates', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const templates = await stub.listTemplates(user.id)

		return c.json(templates)
	} catch (error) {
		logger.error('Error listing templates:', error)
		return c.json({ error: 'Failed to list templates' }, 500)
	}
})

/**
 * GET /bills/templates/:templateId
 * Get a specific template
 */
app.get('/templates/:templateId', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const templateId = c.req.param('templateId')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const template = await stub.getTemplate(user.id, templateId)

		if (!template) {
			return c.json({ error: 'Template not found' }, 404)
		}

		return c.json(template)
	} catch (error) {
		logger.error('Error getting template:', error)
		return c.json({ error: 'Failed to get template' }, 500)
	}
})

/**
 * POST /bills/templates
 * Create a new template
 */
app.post('/templates', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const data = await c.req.json()
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const template = await stub.createTemplate(user.id, data)

		return c.json(template, 201)
	} catch (error) {
		logger.error('Error creating template:', error)
		return c.json({ error: 'Failed to create template' }, 500)
	}
})

/**
 * PUT /bills/templates/:templateId
 * Update a template
 */
app.put('/templates/:templateId', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const templateId = c.req.param('templateId')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const data = await c.req.json()
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const template = await stub.updateTemplate(user.id, templateId, data)

		return c.json(template)
	} catch (error) {
		logger.error('Error updating template:', error)
		return c.json({ error: 'Failed to update template' }, 500)
	}
})

/**
 * DELETE /bills/templates/:templateId
 * Delete a template
 */
app.delete('/templates/:templateId', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const templateId = c.req.param('templateId')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		await stub.deleteTemplate(user.id, templateId)

		return c.json({ success: true })
	} catch (error) {
		logger.error('Error deleting template:', error)
		return c.json({ error: 'Failed to delete template' }, 500)
	}
})

/**
 * POST /bills/templates/clone
 * Clone an existing template
 */
app.post('/templates/clone', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const data = await c.req.json()
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const template = await stub.cloneTemplate(user.id, data)

		return c.json(template, 201)
	} catch (error) {
		logger.error('Error cloning template:', error)
		return c.json({ error: 'Failed to clone template' }, 500)
	}
})

/**
 * POST /bills/templates/clone-from-bill
 * Convert a bill into a template
 */
app.post('/templates/clone-from-bill', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const data = await c.req.json()
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const template = await stub.cloneBillAsTemplate(user.id, data)

		return c.json(template, 201)
	} catch (error) {
		logger.error('Error cloning bill as template:', error)
		return c.json({ error: 'Failed to clone bill as template' }, 500)
	}
})

/**
 * POST /bills/from-template
 * Create a bill from a template
 */
app.post('/from-template', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const data = await c.req.json()
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const bill = await stub.createBillFromTemplate(user.id, data)

		return c.json(bill, 201)
	} catch (error) {
		logger.error('Error creating bill from template:', error)
		return c.json({ error: 'Failed to create bill from template' }, 500)
	}
})

// ===== Schedule Routes =====

/**
 * GET /bills/schedules
 * List schedules
 */
app.get('/schedules', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const frequency = c.req.query('frequency')
		const isActive = c.req.query('isActive') === 'true' ? true : c.req.query('isActive') === 'false' ? false : undefined
		const templateId = c.req.query('templateId')

		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const schedules = await stub.listSchedules(user.id, {
			frequency: frequency as any,
			isActive,
			templateId,
		})

		return c.json(schedules)
	} catch (error) {
		logger.error('Error listing schedules:', error)
		return c.json({ error: 'Failed to list schedules' }, 500)
	}
})

/**
 * GET /bills/schedules/:scheduleId
 * Get a specific schedule
 */
app.get('/schedules/:scheduleId', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const scheduleId = c.req.param('scheduleId')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const schedule = await stub.getSchedule(user.id, scheduleId)

		if (!schedule) {
			return c.json({ error: 'Schedule not found' }, 404)
		}

		return c.json(schedule)
	} catch (error) {
		logger.error('Error getting schedule:', error)
		return c.json({ error: 'Failed to get schedule' }, 500)
	}
})

/**
 * POST /bills/schedules
 * Create a new schedule
 */
app.post('/schedules', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const data = await c.req.json()
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const schedule = await stub.createSchedule(user.id, data)

		return c.json(schedule, 201)
	} catch (error) {
		logger.error('Error creating schedule:', error)
		return c.json({ error: 'Failed to create schedule' }, 500)
	}
})

/**
 * PUT /bills/schedules/:scheduleId
 * Update a schedule
 */
app.put('/schedules/:scheduleId', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const scheduleId = c.req.param('scheduleId')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const data = await c.req.json()
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const schedule = await stub.updateSchedule(user.id, scheduleId, data)

		return c.json(schedule)
	} catch (error) {
		logger.error('Error updating schedule:', error)
		return c.json({ error: 'Failed to update schedule' }, 500)
	}
})

/**
 * DELETE /bills/schedules/:scheduleId
 * Delete a schedule
 */
app.delete('/schedules/:scheduleId', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const scheduleId = c.req.param('scheduleId')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		await stub.deleteSchedule(user.id, scheduleId)

		return c.json({ success: true })
	} catch (error) {
		logger.error('Error deleting schedule:', error)
		return c.json({ error: 'Failed to delete schedule' }, 500)
	}
})

/**
 * POST /bills/schedules/:scheduleId/pause
 * Pause a schedule
 */
app.post('/schedules/:scheduleId/pause', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const scheduleId = c.req.param('scheduleId')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const schedule = await stub.pauseSchedule(user.id, scheduleId)

		return c.json(schedule)
	} catch (error) {
		logger.error('Error pausing schedule:', error)
		return c.json({ error: 'Failed to pause schedule' }, 500)
	}
})

/**
 * POST /bills/schedules/:scheduleId/resume
 * Resume a schedule
 */
app.post('/schedules/:scheduleId/resume', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const scheduleId = c.req.param('scheduleId')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const schedule = await stub.resumeSchedule(user.id, scheduleId)

		return c.json(schedule)
	} catch (error) {
		logger.error('Error resuming schedule:', error)
		return c.json({ error: 'Failed to resume schedule' }, 500)
	}
})

/**
 * GET /bills/schedules/:scheduleId/logs
 * Get schedule execution logs
 */
app.get('/schedules/:scheduleId/logs', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const scheduleId = c.req.param('scheduleId')
	const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : undefined

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const logs = await stub.getScheduleExecutionLogs(user.id, scheduleId, limit)

		return c.json(logs)
	} catch (error) {
		logger.error('Error getting schedule logs:', error)
		return c.json({ error: 'Failed to get schedule logs' }, 500)
	}
})

/**
 * GET /bills/schedules/statistics
 * Get schedule statistics
 */
app.get('/schedules/statistics', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const stats = await stub.getScheduleStatistics(user.id)

		return c.json(stats)
	} catch (error) {
		logger.error('Error getting schedule statistics:', error)
		return c.json({ error: 'Failed to get statistics' }, 500)
	}
})

export default app

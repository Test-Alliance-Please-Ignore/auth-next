/**
 * Bills API client methods
 * Extends the main API client with bills-specific methods
 */

import { ApiClient } from './api'

import type {
	Bill,
	BillListPage,
	BillListSortDirection,
	BillListSortField,
	BillPartyDirection,
	BillSchedule,
	BillScheduleWithDetails,
	BillStatistics,
	BillTemplate,
	BillWithDetails,
	CreateBillFromTemplateInput,
	CreateBillInput,
	CreateScheduleInput,
	CreateTemplateInput,
	EntitySearchType,
	EntityType,
	GroupBillAggregate,
	GroupBillOperationResult,
	ScheduleExecutionLog,
	ScheduleStatistics,
	UpdateBillInput,
	UpdateScheduleInput,
	UpdateTemplateInput,
} from '@repo/bills'

const BILLS_API_BASE = '/admin/bills'

export class BillsApiClient extends ApiClient {
	// ===== Bills API Methods =====

	async getBill(billId: string): Promise<BillWithDetails> {
		return this.get(`${BILLS_API_BASE}/${billId}`)
	}

	async listBills(filters?: {
		status?: string
		payerId?: string
		payeeId?: string
		payerType?: string
		payeeType?: string
		issuerId?: string
		dueAfter?: string
		dueBefore?: string
		createdAfter?: string
		createdBefore?: string
		sortBy?: BillListSortField
		sortDir?: BillListSortDirection
		limit?: number
		offset?: number
		coalesced?: boolean
	}): Promise<BillListPage> {
		const params = new URLSearchParams()
		if (filters?.status) params.set('status', filters.status)
		if (filters?.payerId) params.set('payerId', filters.payerId)
		if (filters?.payeeId) params.set('payeeId', filters.payeeId)
		if (filters?.payerType) params.set('payerType', filters.payerType)
		if (filters?.payeeType) params.set('payeeType', filters.payeeType)
		if (filters?.issuerId) params.set('issuerId', filters.issuerId)
		if (filters?.dueAfter) params.set('dueAfter', filters.dueAfter)
		if (filters?.dueBefore) params.set('dueBefore', filters.dueBefore)
		if (filters?.createdAfter) params.set('createdAfter', filters.createdAfter)
		if (filters?.createdBefore) params.set('createdBefore', filters.createdBefore)
		if (filters?.sortBy) params.set('sortBy', filters.sortBy)
		if (filters?.sortDir) params.set('sortDir', filters.sortDir)
		if (filters?.limit) params.set('limit', String(filters.limit))
		if (filters?.offset !== undefined) params.set('offset', String(filters.offset))
		if (filters?.coalesced === false) params.set('coalesced', 'false')

		const query = params.toString()
		return this.get(`${BILLS_API_BASE}${query ? `?${query}` : ''}`)
	}

	async searchBillParties(params: {
		q: string
		direction?: BillPartyDirection
		entityType?: EntityType
		limit?: number
	}): Promise<
		Array<{ entityId: string; entityType: EntityType; usageCount: number; name: string | null }>
	> {
		const searchParams = new URLSearchParams()
		searchParams.set('q', params.q)
		if (params.direction) searchParams.set('direction', params.direction)
		if (params.entityType) searchParams.set('entityType', params.entityType)
		if (params.limit) searchParams.set('limit', String(params.limit))
		return this.get(`${BILLS_API_BASE}/parties/search?${searchParams.toString()}`)
	}

	async searchEntities(params: {
		q: string
		entityType: EntitySearchType
		limit?: number
	}): Promise<Array<{ entityId: string; entityType: EntitySearchType; name: string | null }>> {
		const searchParams = new URLSearchParams()
		searchParams.set('q', params.q)
		searchParams.set('entityType', params.entityType)
		if (params.limit) searchParams.set('limit', String(params.limit))
		return this.get(`${BILLS_API_BASE}/entities/search?${searchParams.toString()}`)
	}

	async createBill(
		data: CreateBillInput & {
			groupBillOptions?: { includeOwner: boolean; includeAdmins: boolean; includeMembers: boolean }
		}
	): Promise<Bill | { groupBillId: string; bills: Bill[]; billCount: number }> {
		return this.post(`${BILLS_API_BASE}`, data)
	}

	async getGroupBillAggregate(groupBillId: string): Promise<GroupBillAggregate> {
		return this.get(`${BILLS_API_BASE}/group/${groupBillId}`)
	}

	async issueGroupBill(groupBillId: string): Promise<GroupBillOperationResult> {
		return this.post(`${BILLS_API_BASE}/group/${groupBillId}/issue`)
	}

	async cancelGroupBill(groupBillId: string): Promise<GroupBillOperationResult> {
		return this.post(`${BILLS_API_BASE}/group/${groupBillId}/cancel`)
	}

	async revertGroupBillToDraft(groupBillId: string): Promise<GroupBillOperationResult> {
		return this.post(`${BILLS_API_BASE}/group/${groupBillId}/revert-to-draft`)
	}

	async deleteGroupBill(groupBillId: string): Promise<GroupBillOperationResult> {
		return this.delete(`${BILLS_API_BASE}/group/${groupBillId}`)
	}

	async updateGroupBill(
		groupBillId: string,
		data: UpdateBillInput
	): Promise<GroupBillOperationResult> {
		return this.put(`${BILLS_API_BASE}/group/${groupBillId}`, data)
	}

	async updateBill(billId: string, data: UpdateBillInput): Promise<Bill> {
		return this.put(`${BILLS_API_BASE}/${billId}`, data)
	}

	async deleteBill(billId: string): Promise<void> {
		return this.delete(`${BILLS_API_BASE}/${billId}`)
	}

	async issueBill(billId: string): Promise<Bill> {
		return this.post(`${BILLS_API_BASE}/${billId}/issue`)
	}

	async cancelBill(billId: string): Promise<Bill> {
		return this.post(`${BILLS_API_BASE}/${billId}/cancel`)
	}

	async revertBillToDraft(billId: string): Promise<Bill> {
		return this.post(`${BILLS_API_BASE}/${billId}/revert-to-draft`)
	}

	async payBill(paymentToken: string): Promise<Bill> {
		return this.post(`${BILLS_API_BASE}/pay`, { paymentToken })
	}

	async regeneratePaymentToken(billId: string): Promise<{ token: string }> {
		return this.post(`${BILLS_API_BASE}/${billId}/regenerate-token`)
	}

	async getBillStatistics(): Promise<BillStatistics> {
		return this.get(`${BILLS_API_BASE}/statistics`)
	}

	// ===== Templates API Methods =====

	async getTemplate(templateId: string): Promise<BillTemplate> {
		return this.get(`${BILLS_API_BASE}/templates/${templateId}`)
	}

	async listTemplates(): Promise<BillTemplate[]> {
		return this.get(`${BILLS_API_BASE}/templates`)
	}

	async createTemplate(data: CreateTemplateInput): Promise<BillTemplate> {
		return this.post(`${BILLS_API_BASE}/templates`, data)
	}

	async updateTemplate(templateId: string, data: UpdateTemplateInput): Promise<BillTemplate> {
		return this.put(`${BILLS_API_BASE}/templates/${templateId}`, data)
	}

	async deleteTemplate(templateId: string): Promise<void> {
		return this.delete(`${BILLS_API_BASE}/templates/${templateId}`)
	}

	async cloneTemplate(
		sourceTemplateId: string,
		name: string,
		description?: string
	): Promise<BillTemplate> {
		return this.post(`${BILLS_API_BASE}/templates/clone`, {
			sourceTemplateId,
			name,
			description,
		})
	}

	async cloneBillAsTemplate(
		sourceBillId: string,
		name: string,
		description?: string
	): Promise<BillTemplate> {
		return this.post(`${BILLS_API_BASE}/templates/clone-from-bill`, {
			sourceBillId,
			name,
			description,
		})
	}

	async createBillFromTemplate(data: CreateBillFromTemplateInput): Promise<Bill> {
		return this.post(`${BILLS_API_BASE}/from-template`, data)
	}

	// ===== Schedules API Methods =====

	async getSchedule(scheduleId: string): Promise<BillScheduleWithDetails> {
		return this.get(`${BILLS_API_BASE}/schedules/${scheduleId}`)
	}

	async listSchedules(filters?: {
		frequency?: string
		isActive?: boolean
		templateId?: string
	}): Promise<BillScheduleWithDetails[]> {
		const params = new URLSearchParams()
		if (filters?.frequency) params.set('frequency', filters.frequency)
		if (filters?.isActive !== undefined) params.set('isActive', String(filters.isActive))
		if (filters?.templateId) params.set('templateId', filters.templateId)

		const query = params.toString()
		return this.get(`${BILLS_API_BASE}/schedules${query ? `?${query}` : ''}`)
	}

	async createSchedule(data: CreateScheduleInput): Promise<BillSchedule> {
		return this.post(`${BILLS_API_BASE}/schedules`, data)
	}

	async updateSchedule(scheduleId: string, data: UpdateScheduleInput): Promise<BillSchedule> {
		return this.put(`${BILLS_API_BASE}/schedules/${scheduleId}`, data)
	}

	async deleteSchedule(scheduleId: string): Promise<void> {
		return this.delete(`${BILLS_API_BASE}/schedules/${scheduleId}`)
	}

	async pauseSchedule(scheduleId: string): Promise<BillSchedule> {
		return this.post(`${BILLS_API_BASE}/schedules/${scheduleId}/pause`)
	}

	async resumeSchedule(scheduleId: string): Promise<BillSchedule> {
		return this.post(`${BILLS_API_BASE}/schedules/${scheduleId}/resume`)
	}

	async getScheduleExecutionLogs(
		scheduleId: string,
		limit?: number
	): Promise<ScheduleExecutionLog[]> {
		const params = limit ? `?limit=${limit}` : ''
		return this.get(`${BILLS_API_BASE}/schedules/${scheduleId}/logs${params}`)
	}

	async getScheduleStatistics(): Promise<ScheduleStatistics> {
		return this.get(`${BILLS_API_BASE}/schedules/statistics`)
	}
}

// Create and export bills API client instance
export const billsApi = new BillsApiClient()

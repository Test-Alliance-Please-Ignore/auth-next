/**
 * Bills API client methods
 * Extends the main API client with bills-specific methods
 */

import type {
	Bill,
	BillSchedule,
	BillStatistics,
	BillTemplate,
	CreateBillFromTemplateInput,
	CreateBillInput,
	CreateScheduleInput,
	CreateTemplateInput,
	ScheduleExecutionLog,
	ScheduleStatistics,
	UpdateBillInput,
	UpdateScheduleInput,
	UpdateTemplateInput,
} from '@repo/bills'

import { ApiClient } from './api'

const BILLS_API_BASE = '/admin/bills'

export class BillsApiClient extends ApiClient {
	// ===== Bills API Methods =====

	async getBill(billId: string): Promise<Bill> {
		return this.get(`${BILLS_API_BASE}/${billId}`)
	}

	async listBills(filters?: {
		status?: string
		payerId?: string
		payerType?: string
		issuerId?: string
		limit?: number
		offset?: number
	}): Promise<Bill[]> {
		const params = new URLSearchParams()
		if (filters?.status) params.set('status', filters.status)
		if (filters?.payerId) params.set('payerId', filters.payerId)
		if (filters?.payerType) params.set('payerType', filters.payerType)
		if (filters?.issuerId) params.set('issuerId', filters.issuerId)
		if (filters?.limit) params.set('limit', String(filters.limit))
		if (filters?.offset) params.set('offset', String(filters.offset))

		const query = params.toString()
		return this.get(`${BILLS_API_BASE}${query ? `?${query}` : ''}`)
	}

	async createBill(data: CreateBillInput): Promise<Bill> {
		return this.post(`${BILLS_API_BASE}`, data)
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

	async cloneTemplate(sourceTemplateId: string, name: string, description?: string): Promise<BillTemplate> {
		return this.post(`${BILLS_API_BASE}/templates/clone`, {
			sourceTemplateId,
			name,
			description,
		})
	}

	async cloneBillAsTemplate(sourceBillId: string, name: string, description?: string): Promise<BillTemplate> {
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

	async getSchedule(scheduleId: string): Promise<BillSchedule> {
		return this.get(`${BILLS_API_BASE}/schedules/${scheduleId}`)
	}

	async listSchedules(filters?: {
		frequency?: string
		isActive?: boolean
		templateId?: string
	}): Promise<BillSchedule[]> {
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

	async getScheduleExecutionLogs(scheduleId: string, limit?: number): Promise<ScheduleExecutionLog[]> {
		const params = limit ? `?limit=${limit}` : ''
		return this.get(`${BILLS_API_BASE}/schedules/${scheduleId}/logs${params}`)
	}

	async getScheduleStatistics(): Promise<ScheduleStatistics> {
		return this.get(`${BILLS_API_BASE}/schedules/statistics`)
	}
}

// Create and export bills API client instance
export const billsApi = new BillsApiClient()

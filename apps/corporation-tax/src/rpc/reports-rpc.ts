import type {
	ListTaxDiscrepancyReportFilters,
	ListTaxMissingEsiKeyReportFilters,
	TaxBillStatusReportRow,
	TaxCompliancePoint,
	TaxDiscrepancy,
	TaxEssPayoutRow,
	TaxMemberSummary,
	TaxMemberSummaryReportFilters,
	TaxMissingEsiKeyRow,
	TaxPagedResult,
	TaxRollupReportFilters,
	TaxSummaryReport,
	TaxTopIncomeSourceMonthlyRow,
	TaxTopIncomeSourceRow,
	TaxTotalTaxesByCorporationRow,
} from '@repo/corporation-tax'
import type { TaxReportService } from '../services/tax-report.service'

type ReportsRpcContext = {
	reportService: TaxReportService
}

export class TaxReportsRpc {
	constructor(private readonly ctx: ReportsRpcContext) {}

	getSummaryReport(filters?: TaxRollupReportFilters): Promise<TaxSummaryReport> {
		return this.ctx.reportService.getSummaryReport(filters)
	}

	getTotalTaxesByCorporationReport(
		filters?: TaxRollupReportFilters
	): Promise<TaxPagedResult<TaxTotalTaxesByCorporationRow>> {
		return this.ctx.reportService.getTotalTaxesByCorporationReport(filters)
	}

	getTopIncomeSourcesReport(filters?: TaxRollupReportFilters): Promise<TaxTopIncomeSourceRow[]> {
		return this.ctx.reportService.getTopIncomeSourcesReport(filters)
	}

	getTopIncomeSourcesMonthlyReport(
		filters?: TaxRollupReportFilters
	): Promise<TaxTopIncomeSourceMonthlyRow[]> {
		return this.ctx.reportService.getTopIncomeSourcesMonthlyReport(filters)
	}

	getEssPayoutReport(filters?: TaxRollupReportFilters): Promise<TaxPagedResult<TaxEssPayoutRow>> {
		return this.ctx.reportService.getEssPayoutReport(filters)
	}

	getComplianceOverTimeReport(filters?: TaxRollupReportFilters): Promise<TaxCompliancePoint[]> {
		return this.ctx.reportService.getComplianceOverTimeReport(filters)
	}

	getTaxDiscrepancyReport(
		filters?: ListTaxDiscrepancyReportFilters
	): Promise<TaxPagedResult<TaxDiscrepancy>> {
		return this.ctx.reportService.getTaxDiscrepancyReport(filters)
	}

	getMissingEsiKeysReport(
		filters?: ListTaxMissingEsiKeyReportFilters
	): Promise<TaxPagedResult<TaxMissingEsiKeyRow>> {
		return this.ctx.reportService.getMissingEsiKeysReport(filters)
	}

	getBillStatusReport(
		filters?: TaxRollupReportFilters
	): Promise<TaxPagedResult<TaxBillStatusReportRow>> {
		return this.ctx.reportService.getBillStatusReport(filters)
	}

	getMemberSummaryReport(
		filters: TaxMemberSummaryReportFilters
	): Promise<TaxPagedResult<TaxMemberSummary>> {
		return this.ctx.reportService.getMemberSummaryReport(filters)
	}
}

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { formatTaxDateTime } from '@/lib/tax-date'
import { formatTaxIskFull, formatTaxNumber, TaxEntityDisplay } from '@/lib/tax-display'

import { billStatusBadgeVariant } from './helpers'

import type { TaxBillStatusReportRow } from '@repo/corporation-tax'

type BillStatusRollupCardProps = {
	billStatusLoading: boolean
	billStatusError: unknown
	billStatusReportRows: TaxBillStatusReportRow[]
	entityNames: Record<string, string>
	billStatusPage: number
	billStatusPageCount: number
	billStatusTotalRows: number
	billStatusPageSize: number
	onChangePageSize: (nextSize: number) => void
	onPreviousPage: () => void
	onNextPage: () => void
}

export function BillStatusRollupCard({
	billStatusLoading,
	billStatusError,
	billStatusReportRows,
	entityNames,
	billStatusPage,
	billStatusPageCount,
	billStatusTotalRows,
	billStatusPageSize,
	onChangePageSize,
	onPreviousPage,
	onNextPage,
}: BillStatusRollupCardProps) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Bill Status Rollup</CardTitle>
				<CardDescription>
					Corporation-scope assessment counts and tax totals grouped by bill lifecycle status.
				</CardDescription>
			</CardHeader>
			<CardContent>
				{billStatusLoading ? (
					<div className="py-8 text-sm text-muted-foreground">Loading bill status report...</div>
				) : billStatusError ? (
					<div className="py-8 text-sm text-destructive">
						{billStatusError instanceof Error
							? billStatusError.message
							: 'Failed to load bill status report'}
					</div>
				) : billStatusReportRows.length === 0 ? (
					<div className="py-8 text-sm text-muted-foreground">
						No bill status data matched the current scope.
					</div>
				) : (
					<div className="space-y-3">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Corporation</TableHead>
									<TableHead>Status</TableHead>
									<TableHead>Issue Date</TableHead>
									<TableHead>Due Date</TableHead>
									<TableHead>Assessments</TableHead>
									<TableHead>Tax Due</TableHead>
									<TableHead>Tax Paid</TableHead>
									<TableHead>Delta</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{billStatusReportRows.map((row) => (
									<TableRow key={`${row.corporationId}-${row.billStatus}`}>
										<TableCell className="font-medium">
											<TaxEntityDisplay entityId={row.corporationId} entityNames={entityNames} />
										</TableCell>
										<TableCell>
											<Badge variant={billStatusBadgeVariant(row.billStatus)}>{row.billStatus}</Badge>
										</TableCell>
										<TableCell>{formatTaxDateTime(row.issueDate)}</TableCell>
										<TableCell>{formatTaxDateTime(row.dueDate)}</TableCell>
										<TableCell>{formatTaxNumber(row.assessmentCount)}</TableCell>
										<TableCell>{formatTaxIskFull(row.taxDue)}</TableCell>
										<TableCell>{formatTaxIskFull(row.taxPaid)}</TableCell>
										<TableCell>{formatTaxIskFull(row.taxDelta)}</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
						<div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
							<div>
								Page {billStatusPage + 1} of {billStatusPageCount} (
								{formatTaxNumber(billStatusTotalRows)} rows)
							</div>
							<div className="flex items-center gap-2">
								<Select
									value={String(billStatusPageSize)}
									onValueChange={(value) => {
										const parsed = Number.parseInt(value, 10)
										if (!Number.isFinite(parsed)) return
										onChangePageSize(parsed)
									}}
								>
									<SelectTrigger className="h-9 w-[110px]">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="25">25 / page</SelectItem>
										<SelectItem value="50">50 / page</SelectItem>
										<SelectItem value="100">100 / page</SelectItem>
										<SelectItem value="200">200 / page</SelectItem>
									</SelectContent>
								</Select>
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={onPreviousPage}
									disabled={billStatusPage === 0}
								>
									Previous
								</Button>
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={onNextPage}
									disabled={billStatusPage + 1 >= billStatusPageCount}
								>
									Next
								</Button>
							</div>
						</div>
					</div>
				)}
			</CardContent>
		</Card>
	)
}

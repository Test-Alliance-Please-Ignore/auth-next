import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { TaxCorporationDisplay, TaxEntityDisplay } from '@/lib/tax-display'

import type { TaxCorporationBillingConfig } from '@repo/corporation-tax'

type BillingConfigurationTableProps = {
	canIssue: boolean
	billingConfigs: TaxCorporationBillingConfig[]
	loading: boolean
	error: unknown
	entityNames: Record<string, string>
	actionsDisabled: boolean
	onEdit: (config: TaxCorporationBillingConfig) => void
	onSetDefault: (configId: string) => void
	onDelete: (configId: string) => void
}

export function BillingConfigurationTable({
	canIssue,
	billingConfigs,
	loading,
	error,
	entityNames,
	actionsDisabled,
	onEdit,
	onSetDefault,
	onDelete,
}: BillingConfigurationTableProps) {
	if (loading) {
		return <div className="text-sm text-muted-foreground">Loading billing configs...</div>
	}
	if (error) {
		return (
			<div className="text-sm text-destructive">
				{error instanceof Error ? error.message : 'Failed to load billing configurations'}
			</div>
		)
	}

	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>Default</TableHead>
					<TableHead>Enabled</TableHead>
					<TableHead>Payee</TableHead>
					<TableHead>Issuer</TableHead>
					<TableHead>Due Days</TableHead>
					{canIssue ? <TableHead className="text-center">Actions</TableHead> : null}
				</TableRow>
			</TableHeader>
			<TableBody>
				{billingConfigs.length === 0 ? (
					<TableRow>
						<TableCell colSpan={canIssue ? 6 : 5} className="text-sm text-muted-foreground">
							No billing configs yet. Create one below.
						</TableCell>
					</TableRow>
				) : (
					billingConfigs.map((config) => (
						<TableRow key={config.id}>
							<TableCell>
								{config.isDefault ? <Badge variant="default">default</Badge> : '-'}
							</TableCell>
							<TableCell>{config.billingEnabled ? 'yes' : 'no'}</TableCell>
							<TableCell>
								{config.billingPayeeType && config.billingPayeeId ? (
									<div className="space-y-1">
										<Badge variant="ghost" className="capitalize">
											{config.billingPayeeType}
										</Badge>
										{config.billingPayeeType === 'corporation' ? (
											<TaxCorporationDisplay
												corporationId={config.billingPayeeId}
												entityNames={entityNames}
											/>
										) : (
											<TaxEntityDisplay
												entityId={config.billingPayeeId}
												entityNames={entityNames}
											/>
										)}
									</div>
								) : (
									'-'
								)}
							</TableCell>
							<TableCell>{config.billingIssuerUserId || '-'}</TableCell>
							<TableCell>{config.billingDueDays}</TableCell>
							{canIssue ? (
								<TableCell className="text-right">
									<div className="flex items-center justify-end gap-2">
										<Button
											variant="ghost"
											size="sm"
											disabled={actionsDisabled}
											onClick={() => onEdit(config)}
										>
											Edit
										</Button>
										<Button
											variant="primary"
											size="sm"
											disabled={actionsDisabled || config.isDefault}
											onClick={() => onSetDefault(config.id)}
										>
											Set Default
										</Button>
										<Button
											variant="destructive"
											size="sm"
											showIcon={false}
											disabled={actionsDisabled || config.isDefault}
											onClick={() => onDelete(config.id)}
										>
											Delete
										</Button>
									</div>
								</TableCell>
							) : null}
						</TableRow>
					))
				)}
			</TableBody>
		</Table>
	)
}

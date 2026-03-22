import { Badge } from '@/components/ui/badge'
import { DestructiveButton } from '@/components/ui/destructive-button'
import { GhostButton } from '@/components/ui/ghost-button'
import { PrimaryButton } from '@/components/ui/primary-button'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { TaxEntityDisplay } from '@/lib/tax-display'

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
										<Badge variant="outline" className="capitalize">
											{config.billingPayeeType}
										</Badge>
										<TaxEntityDisplay entityId={config.billingPayeeId} entityNames={entityNames} />
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
										<GhostButton
											size="sm"
											disabled={actionsDisabled}
											onClick={() => onEdit(config)}
										>
											Edit
										</GhostButton>
										<PrimaryButton
											size="sm"
											disabled={actionsDisabled || config.isDefault}
											onClick={() => onSetDefault(config.id)}
										>
											Set Default
										</PrimaryButton>
										<DestructiveButton
											size="sm"
											showIcon={false}
											disabled={actionsDisabled || config.isDefault}
											onClick={() => onDelete(config.id)}
										>
											Delete
										</DestructiveButton>
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

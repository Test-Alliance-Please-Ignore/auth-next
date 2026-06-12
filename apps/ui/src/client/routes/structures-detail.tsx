import { Save } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { FilterField } from '@/components/ui/filter-field'
import { LoadingPage } from '@/components/ui/loading'
import { PageHeader } from '@/components/ui/page-header'
import { Select, type SelectOption } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { StructureStateBadge } from '@/components/structure-state-badge'
import { useApiMutation } from '@/hooks/useApiMutation'
import { useAuth } from '@/hooks/useAuth'
import { useGroups } from '@/hooks/useGroups'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import { api, type StructureDetailResult } from '@/lib/api'
import { formatDateTimeLong } from '@/lib/date-utils'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { hasAnyStructurePermission } from '@repo/groups'

function detailBadgeVariant(syncStatus: StructureDetailResult['syncStatus']) {
	if (syncStatus === 'error') return 'destructive'
	if (syncStatus === 'warning') return 'warning'
	return 'success'
}

export default function StructuresDetailPage() {
	const { structureId } = useParams<{ structureId: string }>()
	const queryClient = useQueryClient()
	const { user, isLoading: authLoading } = useAuth()
	const { permissions, isLoading: permissionsLoading } = useUserPermissions()
	const canViewStructures = user?.is_admin === true || hasAnyStructurePermission(permissions)
	const canAccess = canViewStructures && Boolean(structureId)
	const {
		data: structure,
		isLoading,
		error,
	} = useQuery({
		queryKey: ['structures', structureId],
		queryFn: () => api.getStructure(structureId!),
		enabled: canAccess,
	})

	const { data: groups = [] } = useGroups({ limit: 100 })
	const [hidden, setHidden] = useState(false)
	const [lowPowerAllowed, setLowPowerAllowed] = useState(false)
	const [assignedGroupId, setAssignedGroupId] = useState('')

	usePageTitle(structure ? `Structure - ${structure.name}` : 'Structure Details')

	useEffect(() => {
		if (!structure) return
		setHidden(structure.hidden)
		setLowPowerAllowed(structure.lowPowerAllowed)
		setAssignedGroupId(structure.assignedGroupId ?? '')
	}, [structure])

	const groupOptions = useMemo<SelectOption[]>(() => {
		return [
			{ value: '', label: 'No Group' },
			...groups
				.slice()
				.sort((left, right) => left.name.localeCompare(right.name))
				.map((group) => ({ value: group.id, label: group.name })),
		]
	}, [groups])

	const updateMutation = useApiMutation({
		mutationFn: (data: { hidden: boolean; lowPowerAllowed: boolean; assignedGroupId: string | null }) =>
			api.updateStructureConfig(structureId!, data),
		successMessage: 'Structure configuration saved.',
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ['structures'] }),
				queryClient.invalidateQueries({ queryKey: ['structures', structureId] }),
			])
		},
	})

	if (!authLoading && !permissionsLoading && !canViewStructures) {
		return <Navigate to="/dashboard" replace />
	}

	if (!structureId) {
		return <Navigate to="/structures" replace />
	}

	if (isLoading) {
		return <LoadingPage label="Loading structure..." />
	}

	if (error || !structure) {
		return (
			<Container className="py-6">
				<Card>
					<CardHeader>
						<CardTitle>Structure not found</CardTitle>
						<CardDescription>
							The requested structure could not be loaded or is not visible to your permissions.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<Button asChild variant="ghost">
							<Link to="/structures">Back to Structures</Link>
						</Button>
					</CardContent>
				</Card>
			</Container>
		)
	}

	const syncTitle = structure.syncFailureReason ?? 'Structure sync is healthy and up to date.'
	const fuelLabel =
		structure.fuelAmount !== null
			? `${structure.fuelAmount.toLocaleString()} units`
			: structure.fuelExpires
				? formatDateTimeLong(structure.fuelExpires)
				: '-'

	const handleSave = async () => {
		await updateMutation.mutateAsync({
			hidden,
			lowPowerAllowed,
			assignedGroupId: assignedGroupId || null,
		})
	}

	return (
		<Container className="space-y-6 py-6">
			<PageHeader
				title={structure.name}
				description={`${structure.corporationName} · ${structure.systemName ?? structure.systemId}`}
				action={
					<div className="flex gap-2">
						<Badge variant={detailBadgeVariant(structure.syncStatus)} title={syncTitle}>
							{structure.syncStatus}
						</Badge>
						<Button asChild variant="ghost" size="sm">
							<Link to="/structures">Back</Link>
						</Button>
					</div>
				}
			/>

			<div className="grid gap-4 md:grid-cols-2">
				<Card>
					<CardHeader>
						<CardTitle>Structure Summary</CardTitle>
						<CardDescription>Current synced state and operational metadata.</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4 text-sm">
						<div className="grid grid-cols-2 gap-4">
							<div>
								<div className="text-muted-foreground">Region</div>
								<div className="font-medium">{structure.regionName ?? structure.regionId ?? '-'}</div>
							</div>
							<div>
								<div className="text-muted-foreground">System</div>
								<div className="font-medium">{structure.systemName ?? structure.systemId}</div>
							</div>
							<div>
								<div className="text-muted-foreground">Type</div>
								<div className="font-medium">{structure.typeName ?? structure.typeId}</div>
							</div>
							<div>
								<div className="text-muted-foreground">Fuel</div>
								<div className="font-medium">{fuelLabel}</div>
							</div>
							<div>
								<div className="text-muted-foreground">State</div>
								<div className="font-medium">
									<StructureStateBadge state={structure.state} />
								</div>
							</div>
							<div>
								<div className="text-muted-foreground">Next State</div>
								<div className="font-medium">
									{structure.nextStateAt ? formatDateTimeLong(structure.nextStateAt) : '-'}
								</div>
							</div>
							<div>
								<div className="text-muted-foreground">Last Synced</div>
								<div className="font-medium">
									{structure.lastSyncedAt ? formatDateTimeLong(structure.lastSyncedAt) : '-'}
								</div>
							</div>
							<div>
								<div className="text-muted-foreground">Low Power</div>
								<div className="font-medium">{structure.lowPower ? 'Yes' : 'No'}</div>
							</div>
						</div>
						<div className="flex flex-wrap gap-2 pt-2">
							{structure.hidden && <Badge variant="ghost">Hidden</Badge>}
							{structure.lowPowerAllowed && <Badge variant="success">Low Power Alerts Suppressed</Badge>}
							{structure.assignedGroupId && <Badge variant="special">Group Assigned</Badge>}
						</div>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Structure Configuration</CardTitle>
						<CardDescription>
							Manager-level settings for visibility, alert suppression, and group assignment.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-5">
						<div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 p-4">
							<div>
								<div className="font-medium">Hidden</div>
								<div className="text-sm text-muted-foreground">
									Completely omit this structure from non-sensitive users.
								</div>
							</div>
							<Switch checked={hidden} onCheckedChange={setHidden} />
						</div>
						<div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 p-4">
							<div>
								<div className="font-medium">Low Power Allowed</div>
								<div className="text-sm text-muted-foreground">
									Suppress low-power alerts for structures where that is intentional.
								</div>
							</div>
							<Switch checked={lowPowerAllowed} onCheckedChange={setLowPowerAllowed} />
						</div>
						<FilterField label="Assigned Group">
							<Select
								options={groupOptions}
								value={assignedGroupId}
								onValueChange={(value) => setAssignedGroupId(value)}
								placeholder="No Group"
							/>
						</FilterField>
						<div className="flex items-center justify-end gap-3 pt-2">
							<Button
								variant="ghost"
								onClick={() => {
									setHidden(structure.hidden)
									setLowPowerAllowed(structure.lowPowerAllowed)
									setAssignedGroupId(structure.assignedGroupId ?? '')
								}}
							>
								Reset
							</Button>
							<Button
								variant="confirm"
								onClick={() => void handleSave()}
								loading={updateMutation.isPending}
							>
								<Save className="h-4 w-4" />
								Save Changes
							</Button>
						</div>
					</CardContent>
				</Card>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Operational Fields</CardTitle>
					<CardDescription>
						These fields are populated by sync and used by the table and alerting flows.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="grid gap-4 md:grid-cols-3">
						<div className="rounded-lg border border-border/60 p-4">
							<div className="text-xs uppercase tracking-wide text-muted-foreground">Profile</div>
							<div className="mt-2 font-medium">{structure.profileId}</div>
						</div>
						<div className="rounded-lg border border-border/60 p-4">
							<div className="text-xs uppercase tracking-wide text-muted-foreground">
								Corporation ID
							</div>
							<div className="mt-2 font-medium">{structure.corporationId}</div>
						</div>
						<div className="rounded-lg border border-border/60 p-4">
							<div className="text-xs uppercase tracking-wide text-muted-foreground">Structure ID</div>
							<div className="mt-2 font-medium">{structure.structureId}</div>
						</div>
					</div>
				</CardContent>
			</Card>
		</Container>
	)
}

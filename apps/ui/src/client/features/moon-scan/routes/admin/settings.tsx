import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { useUserPermissions } from '@/hooks/useUserPermissions'

import { useAdminSettings, useUpdateExtractionSettings, useUpdateStructureProfile } from '../../hooks'

import type { ExtractionSettings, StructureProfile, StructureType } from '../../types'

interface ProfileDraft {
	baseVolumePerHr: string
	fuelPerHr: string
	magmaticGasPerHr: string | null
}

function ProfileRow({
	label,
	profile,
	onSave,
	isSaving,
}: {
	label: string
	profile: StructureProfile
	onSave: (draft: ProfileDraft) => void
	isSaving: boolean
}) {
	const [draft, setDraft] = useState<ProfileDraft>({
		baseVolumePerHr: profile.baseVolumePerHr,
		fuelPerHr: profile.fuelPerHr,
		magmaticGasPerHr: profile.magmaticGasPerHr,
	})

	return (
		<tr>
			<td className="px-4 py-2.5 font-medium whitespace-nowrap">{label}</td>
			<td className="px-4 py-2.5">
				{profile.isPassive
					? <Badge variant="secondary">Passive</Badge>
					: <Badge>Active</Badge>}
			</td>
			<td className="px-4 py-2.5">
				<input
					type="number"
					className="w-28 rounded border bg-background px-2 py-1 text-sm font-mono"
					value={draft.baseVolumePerHr}
					step="0.01"
					onChange={(e) => setDraft((d) => ({ ...d, baseVolumePerHr: e.target.value }))}
				/>
			</td>
			<td className="px-4 py-2.5">
				<input
					type="number"
					className="w-24 rounded border bg-background px-2 py-1 text-sm font-mono"
					value={draft.fuelPerHr}
					step="0.1"
					onChange={(e) => setDraft((d) => ({ ...d, fuelPerHr: e.target.value }))}
				/>
			</td>
			<td className="px-4 py-2.5">
				{draft.magmaticGasPerHr !== null ? (
					<input
						type="number"
						className="w-24 rounded border bg-background px-2 py-1 text-sm font-mono"
						value={draft.magmaticGasPerHr}
						step="0.1"
						onChange={(e) => setDraft((d) => ({ ...d, magmaticGasPerHr: e.target.value }))}
					/>
				) : (
					<span className="text-muted-foreground tabular-nums">0.0</span>
				)}
			</td>
			<td className="px-4 py-2.5">
				<Button size="sm" onClick={() => onSave(draft)} disabled={isSaving}>Save</Button>
			</td>
		</tr>
	)
}

function GlobalSettingsForm({
	settings,
	onSave,
	isSaving,
}: {
	settings: ExtractionSettings
	onSave: (s: Partial<ExtractionSettings>) => void
	isSaving: boolean
}) {
	const [draft, setDraft] = useState({
		defaultCycleDays: String(settings.defaultCycleDays),
		defaultReprocessingYield: settings.defaultReprocessingYield,
		fuelBlockPriceOverride: settings.fuelBlockPriceOverride ?? '0',
		magmaticGasPriceOverride: settings.magmaticGasPriceOverride ?? '0',
	})

	const rows: Array<{ key: keyof typeof draft; label: string; step: string; description: string }> = [
		{
			key: 'defaultCycleDays',
			label: 'default_cycle_days',
			step: '1',
			description: 'Default cycle days for Metenox and Refinery profit calculations.',
		},
		{
			key: 'defaultReprocessingYield',
			label: 'default_reprocessing_yield',
			step: '0.0001',
			description: 'Default reprocessing efficiency (0.0–1.0). Typical for well-skilled Tatara.',
		},
		{
			key: 'fuelBlockPriceOverride',
			label: 'fuel_block_price_override',
			step: '0.0001',
			description: 'Override fuel block price (0 = use cheapest Jita sell).',
		},
		{
			key: 'magmaticGasPriceOverride',
			label: 'magmatic_gas_price_override',
			step: '0.0001',
			description: 'Override Magmatic Gas price (0 = use Jita sell).',
		},
	]

	return (
		<div>
			<div className="overflow-x-auto">
				<table className="w-full text-sm">
					<thead>
						<tr className="border-b text-left text-xs text-muted-foreground">
							<th className="px-4 py-2 font-medium">Setting</th>
							<th className="px-4 py-2 font-medium">Value</th>
							<th className="px-4 py-2 font-medium">Description</th>
						</tr>
					</thead>
					<tbody className="divide-y">
						{rows.map(({ key, label, step, description }) => (
							<tr key={key}>
								<td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap">{label}</td>
								<td className="px-4 py-2.5">
									<input
										type="number"
										className="w-36 rounded border bg-background px-2 py-1 text-sm font-mono"
										value={draft[key]}
										step={step}
										onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
									/>
								</td>
								<td className="px-4 py-2.5 text-xs text-muted-foreground">{description}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<div className="px-4 py-3 border-t">
				<Button
					onClick={() => onSave({
						defaultCycleDays: parseInt(draft.defaultCycleDays, 10),
						defaultReprocessingYield: draft.defaultReprocessingYield,
						fuelBlockPriceOverride: draft.fuelBlockPriceOverride === '0' ? null : draft.fuelBlockPriceOverride,
						magmaticGasPriceOverride: draft.magmaticGasPriceOverride === '0' ? null : draft.magmaticGasPriceOverride,
					})}
					disabled={isSaving}
				>
					Save All Settings
				</Button>
			</div>
		</div>
	)
}

const PROFILE_ROWS: Array<{ id: StructureType; label: string }> = [
	{ id: 'metenox', label: 'Metenox Moon Drill' },
	{ id: 'tatara', label: 'Refinery' },
]

export default function AdminSettingsPage() {
	const { hasPermission, isAdmin } = useUserPermissions()
	const canAdmin = isAdmin || hasPermission('urn:moons:admin')

	const { data, isLoading, error } = useAdminSettings()
	const updateSettings = useUpdateExtractionSettings()
	const updateProfile = useUpdateStructureProfile()

	if (!canAdmin) {
		return (
			<Container>
				<PageHeader title="Extraction Settings" description="You do not have permission to manage moon settings." />
			</Container>
		)
	}

	const isSaving = updateSettings.isPending || updateProfile.isPending

	return (
		<Container>
			<PageHeader
				title="Extraction Settings"
				description="Configure structure profiles and global extraction parameters."
			/>

			{error && (
				<div className="mt-4 rounded-lg border border-red-500/50 bg-red-500/10 p-4 text-sm text-red-500">
					Failed to load settings
				</div>
			)}

			{isLoading ? (
				<div className="mt-section space-y-3">
					{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
				</div>
			) : data && (
				<div className="mt-section space-y-6">

					{/* Structure Profiles */}
					<div className="rounded-md border bg-card">
						<div className="border-b px-4 py-3 text-sm font-semibold">Structure Profiles</div>
						<div className="overflow-x-auto">
							<table className="w-full text-sm">
								<thead>
									<tr className="border-b text-left text-xs text-muted-foreground">
										<th className="px-4 py-2 font-medium">Structure</th>
										<th className="px-4 py-2 font-medium">Extraction Type</th>
										<th className="px-4 py-2 font-medium">Base Rate (m³/hr)</th>
										<th className="px-4 py-2 font-medium">Fuel Blocks/hr</th>
										<th className="px-4 py-2 font-medium">Magmatic Gas/hr</th>
										<th className="px-4 py-2 font-medium">Actions</th>
									</tr>
								</thead>
								<tbody className="divide-y">
									{PROFILE_ROWS.map(({ id, label }) => {
										const profile = data.profiles.find((p) => p.id === id)
										if (!profile) return null
										return (
											<ProfileRow
												key={id}
												label={label}
												profile={profile}
												isSaving={isSaving}
												onSave={(draft) => updateProfile.mutate({ id, profile: draft })}
											/>
										)
									})}
								</tbody>
							</table>
						</div>
					</div>

					{/* Global Settings */}
					<div className="rounded-md border bg-card">
						<div className="border-b px-4 py-3 text-sm font-semibold">Global Extraction Settings</div>
						<GlobalSettingsForm
							settings={data.settings}
							isSaving={isSaving}
							onSave={(s) => updateSettings.mutate(s)}
						/>
					</div>

				</div>
			)}
		</Container>
	)
}

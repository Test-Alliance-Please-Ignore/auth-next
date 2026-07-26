import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router'
import toast from '@/lib/toast'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EveTimeDisplay } from '@/components/ui/eve-time-display'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import { useCreateRequest } from '../hooks'
import type { RecentLossVictimItem } from '../types'
import { getKillmailUrl } from '../utils'
import { transformKillmailToCargoItems, transformKillmailToFittingItems } from '../utils/fitting'
import { SRPFittingDisplay } from './SRPFittingDisplay'

const createRequestSchema = z.object({
	killmailId: z.string().min(1),
	killmailHash: z.string().min(1),
	characterId: z.string().min(1),
	contextText: z.string().trim().min(1, 'Context is required').max(2000),
})

type CreateRequestFormData = z.infer<typeof createRequestSchema>

interface KillmailPreview {
	victimItems: Array<{
		typeId: string
		flag: number
		quantityDestroyed: number
		quantityDropped: number
	}>
	itemPrices: Array<{
		typeId: string
		quantity: number
		unitPrice: string
		lineTotal: string
		isConsumable?: boolean
	}>
	itemNames: Record<string, string>
}

interface CreateRequestFormProps {
	killmailId: string
	killmailHash: string
	characterId: string
	shipTypeId: string
	shipTypeName: string
	lossDate: string
	lossVictimItems?: RecentLossVictimItem[]
	preview: KillmailPreview | null
	previewLoading: boolean
}

type NormalizedVictimItem = {
	item_type_id: number
	flag: number
	quantity_destroyed?: number
	quantity_dropped?: number
	items?: NormalizedVictimItem[]
}

function normalizeVictimItems(items: RecentLossVictimItem[]): NormalizedVictimItem[] {
	return items.map((item) => ({
		item_type_id: Number(item.item_type_id),
		flag: item.flag,
		quantity_destroyed: item.quantity_destroyed,
		quantity_dropped: item.quantity_dropped,
		items: item.items?.length ? normalizeVictimItems(item.items) : undefined,
	}))
}

function normalizePreviewVictimItems(items: KillmailPreview['victimItems']): NormalizedVictimItem[] {
	return items.map((item) => ({
		item_type_id: Number(item.typeId),
		flag: item.flag,
		quantity_destroyed: item.quantityDestroyed,
		quantity_dropped: item.quantityDropped,
	}))
}

export function CreateRequestForm({
	killmailId,
	killmailHash,
	characterId,
	shipTypeId,
	shipTypeName,
	lossDate,
	lossVictimItems,
	preview,
	previewLoading,
}: CreateRequestFormProps) {
	const navigate = useNavigate()
	const createMutation = useCreateRequest()

	const form = useForm<CreateRequestFormData>({
		resolver: zodResolver(createRequestSchema),
		defaultValues: { killmailId, killmailHash, characterId, contextText: '' },
	})

	const displayVictimItems =
		lossVictimItems?.length
			? normalizeVictimItems(lossVictimItems)
			: preview?.victimItems?.length
				? normalizePreviewVictimItems(preview.victimItems)
				: []
	const fittingItems = transformKillmailToFittingItems(
		displayVictimItems,
		preview?.itemPrices?.map((p) => ({
			typeId: p.typeId,
			price: p.unitPrice,
			isConsumable: p.isConsumable,
		})) ?? [],
		preview?.itemNames ?? {}
	)
	const cargoItems = transformKillmailToCargoItems(
		displayVictimItems,
		preview?.itemNames ?? {}
	)

	const onSubmit = form.handleSubmit(async (data) => {
		try {
			const result = await createMutation.mutateAsync(data)
			toast.success('SRP request submitted')
			void navigate(`/srp/request/${result.id}`, { replace: true })
		} catch (error: any) {
			toast.error('Failed to create request', { description: error.message || 'Please try again' })
		}
	})

	return (
		<form
			onSubmit={(e) => void onSubmit(e)}
			className="mx-auto flex w-full flex-col gap-6 lg:max-w-[50vw]"
		>
			<Card className="w-full p-6">
				<div className="mb-4 flex items-center justify-between">
					<div>
						<h3 className="font-semibold">{shipTypeName}</h3>
						<EveTimeDisplay dateStr={lossDate} className="text-sm text-muted-foreground" />
					</div>
					<Button variant="ghost" size="sm" asChild>
						<a href={getKillmailUrl(killmailId)} target="_blank" rel="noopener noreferrer">
							View on zKillboard →
						</a>
					</Button>
				</div>

				<div className="space-y-4">
					<div>
						<Label htmlFor="contextText">Context *</Label>
						<Textarea
							id="contextText"
							placeholder="Describe the circumstances —FC name, discord ping, SRP token,  what happened, etc."
							rows={6}
							className="min-h-40"
							{...form.register('contextText')}
						/>
						<p className="mt-1 text-xs text-muted-foreground">
							If you want full value reimbursement, you must include the fleet ping and/or SRP
							token.
						</p>
						{form.formState.errors.contextText && (
							<p className="mt-1 text-xs text-red-500">
								{form.formState.errors.contextText.message}
							</p>
						)}
					</div>

					<div className="flex gap-2">
						<Button
							type="button"
							variant="ghost"
							onClick={() => navigate('/srp')}
							disabled={createMutation.isPending}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={createMutation.isPending}>
							{createMutation.isPending ? 'Submitting...' : 'Submit Request'}
						</Button>
					</div>
				</div>
			</Card>

			<SRPFittingDisplay
				shipTypeId={shipTypeId}
				shipTypeName={shipTypeName}
				fittingItems={fittingItems}
				cargoItems={cargoItems}
				showPricing={false}
				panelLoading={previewLoading}
			/>
		</form>
	)
}

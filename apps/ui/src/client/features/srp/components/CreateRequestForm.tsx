import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EveTimeDisplay } from '@/components/ui/eve-time-display'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import { useCreateRequest } from '../hooks'
import { getKillmailUrl } from '../utils'
import { transformKillmailToFittingItems } from '../utils/fitting'
import { SRPFittingPanel } from './SRPFittingPanel'
import { SRPFittingSlotList } from './SRPFittingSlotList'

const createRequestSchema = z.object({
	killmailId: z.string().min(1),
	killmailHash: z.string().min(1),
	characterId: z.string().min(1),
	contextText: z.string().max(2000).optional(),
})

type CreateRequestFormData = z.infer<typeof createRequestSchema>

interface KillmailPreview {
	victimItems: Array<{
		typeId: string
		flag: number
		quantityDestroyed: number
		quantityDropped: number
	}>
	itemPrices: Array<{ typeId: string; quantity: number; unitPrice: string; lineTotal: string }>
	itemNames: Record<string, string>
}

interface CreateRequestFormProps {
	killmailId: string
	killmailHash: string
	characterId: string
	shipTypeId: string
	shipTypeName: string
	lossDate: string
	preview: KillmailPreview | null
	previewLoading: boolean
}

export function CreateRequestForm({
	killmailId,
	killmailHash,
	characterId,
	shipTypeId,
	shipTypeName,
	lossDate,
	preview,
	previewLoading,
}: CreateRequestFormProps) {
	const navigate = useNavigate()
	const createMutation = useCreateRequest()

	const form = useForm<CreateRequestFormData>({
		resolver: zodResolver(createRequestSchema),
		defaultValues: { killmailId, killmailHash, characterId, contextText: '' },
	})

	const fittingItems = preview
		? transformKillmailToFittingItems(
				preview.victimItems.map((i) => ({
					item_type_id: Number(i.typeId),
					flag: i.flag,
					quantity_destroyed: i.quantityDestroyed,
					quantity_dropped: i.quantityDropped,
				})),
				preview.itemPrices.map((p) => ({ typeId: p.typeId, price: p.unitPrice })),
				preview.itemNames
			)
		: []

	const onSubmit = form.handleSubmit(async (data) => {
		try {
			const result = await createMutation.mutateAsync({
				...data,
				contextText: data.contextText || undefined,
			})
			toast.success('SRP request submitted')
			void navigate(`/srp/request/${result.id}`)
		} catch (error: any) {
			toast.error('Failed to create request', { description: error.message || 'Please try again' })
		}
	})

	return (
		<form onSubmit={(e) => void onSubmit(e)} className="grid gap-6 lg:grid-cols-2">
			{/* Left: loss summary + context form */}
			<Card className="self-start p-6">
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
						<Label htmlFor="contextText">Context (Optional)</Label>
						<Textarea
							id="contextText"
							placeholder="Describe the circumstances — fleet doctrine, FC name, what happened, etc."
							rows={4}
							{...form.register('contextText')}
						/>
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

			{/* Right: fitting display (moves below on small screens) */}
			<div className="flex flex-col gap-6">
				<div className="flex justify-center">
					{previewLoading ? (
						<div className="flex h-[398px] w-[398px] items-center justify-center rounded-full border border-border/40">
							<div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
						</div>
					) : (
						<SRPFittingPanel shipTypeId={shipTypeId} items={fittingItems} />
					)}
				</div>
				<SRPFittingSlotList shipTypeId={shipTypeId} items={fittingItems} />
			</div>
		</form>
	)
}

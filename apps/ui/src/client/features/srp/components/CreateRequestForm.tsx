import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { zodResolver } from '@hookform/resolvers/zod'
import { AlertCircle } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { z } from 'zod'
import { useCreateRequest } from '../hooks'
import { formatISK, getKillmailUrl } from '../utils'

const createRequestSchema = z.object({
	killmailId: z.string().min(1, 'Killmail ID required'),
	killmailHash: z.string().min(1, 'Killmail hash required'),
	characterId: z.string().min(1, 'Character required'),
	requestedAmount: z.string().optional(),
})

type CreateRequestFormData = z.infer<typeof createRequestSchema>

interface CreateRequestFormProps {
	killmailId: string
	killmailHash: string
	characterId: string
	shipValue: string
	shipTypeName: string
	lossDate: string
}

export function CreateRequestForm({
	killmailId,
	killmailHash,
	characterId,
	shipValue,
	shipTypeName,
	lossDate,
}: CreateRequestFormProps) {
	const navigate = useNavigate()
	const createMutation = useCreateRequest()

	const form = useForm<CreateRequestFormData>({
		resolver: zodResolver(createRequestSchema),
		defaultValues: {
			killmailId,
			killmailHash,
			characterId,
			requestedAmount: '',
		},
	})

	const onSubmit = form.handleSubmit(async (data) => {
		try {
			const result = await createMutation.mutateAsync({
				...data,
				requestedAmount: data.requestedAmount || undefined,
			})

			toast.success('SRP request submitted successfully', {
				description: `Your payment token is: ${result.paymentToken}`,
			})

			navigate(`/srp/request/${result.id}`)
		} catch (error: any) {
			toast.error('Failed to create request', {
				description: error.message || 'Please try again',
			})
		}
	})

	return (
		<form onSubmit={onSubmit} className="space-y-6">
			{/* Loss Details Card */}
			<Card className="p-6">
				<h3 className="mb-4 font-semibold">Ship Loss Summary</h3>
				<div className="space-y-3 text-sm">
					<div className="grid grid-cols-2 gap-4">
						<div>
							<div className="text-muted-foreground">Ship</div>
							<div className="font-medium">{shipTypeName}</div>
						</div>
						<div>
							<div className="text-muted-foreground">Loss Value</div>
							<div className="font-medium tabular-nums">{formatISK(shipValue)} ISK</div>
						</div>
						<div>
							<div className="text-muted-foreground">Loss Date</div>
							<div className="font-medium">{new Date(lossDate).toLocaleString()}</div>
						</div>
					</div>
					<Button variant="outline" size="sm" asChild>
						<a
							href={getKillmailUrl(killmailId)}
							target="_blank"
							rel="noopener noreferrer"
						>
							View Full Killmail →
						</a>
					</Button>
				</div>
			</Card>

			{/* Request Form Card */}
			<Card className="p-6">
				<h3 className="mb-4 font-semibold">Request Information</h3>
				<div className="space-y-4">
					{/* Requested Amount */}
					<div>
						<Label htmlFor="requestedAmount">Requested Amount (Optional)</Label>
						<Input
							id="requestedAmount"
							type="text"
							placeholder="Leave blank for automatic calculation"
							{...form.register('requestedAmount')}
						/>
						{form.formState.errors.requestedAmount && (
							<p className="mt-1 text-xs text-red-500">
								{form.formState.errors.requestedAmount.message}
							</p>
						)}
						<p className="mt-1 text-xs text-muted-foreground">
							Leave blank to use the configured coverage rate
						</p>
					</div>

					{/* Warning */}
					<div className="flex gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
						<AlertCircle className="h-4 w-4 shrink-0 text-amber-500" />
						<div>
							<p className="font-medium text-amber-500">Important</p>
							<p className="text-muted-foreground">
								Keep your payment token secure once the request is approved. You'll need it to
								confirm payment receipt.
							</p>
						</div>
					</div>

					{/* Submit Buttons */}
					<div className="flex gap-2">
						<Button
							type="button"
							variant="outline"
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
		</form>
	)
}

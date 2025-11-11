import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useAwardDkp, useAwardDkpBulk, type AwardDkpRequest, type DkpSourceType } from '@/features/dkp'
import { usePageTitle } from '@/hooks/usePageTitle'

export default function DkpAwards() {
	usePageTitle('Admin - Award DKP')

	return (
		<div className="space-y-6">
			{/* Header */}
			<div>
				<h1 className="text-3xl font-bold gradient-text">Award DKP</h1>
				<p className="text-muted-foreground mt-1">Manually award DKP to users</p>
			</div>

			<Tabs defaultValue="single" className="w-full">
				<TabsList className="grid w-full max-w-md grid-cols-2">
					<TabsTrigger value="single">Single Award</TabsTrigger>
					<TabsTrigger value="bulk">Bulk Award</TabsTrigger>
				</TabsList>

				<TabsContent value="single" className="space-y-4">
					<SingleAwardForm />
				</TabsContent>

				<TabsContent value="bulk" className="space-y-4">
					<BulkAwardForm />
				</TabsContent>
			</Tabs>
		</div>
	)
}

function SingleAwardForm() {
	const [characterId, setCharacterId] = useState('')
	const [corporationId, setCorporationId] = useState('')
	const [amount, setAmount] = useState('')
	const [sourceType, setSourceType] = useState<DkpSourceType>('manual')
	const [reason, setReason] = useState('')

	const awardDkpMutation = useAwardDkp()

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()

		// Validate
		if (!characterId.trim()) {
			toast.error('Character ID is required')
			return
		}
		if (!amount || Number(amount) <= 0) {
			toast.error('Amount must be greater than 0')
			return
		}
		if (!reason.trim() || reason.trim().length < 10) {
			toast.error('Reason must be at least 10 characters')
			return
		}

		const request: AwardDkpRequest = {
			characterId: characterId.trim(),
			corporationId: corporationId.trim() || undefined,
			amount: Number(amount),
			sourceType,
			awardReason: reason.trim(),
		}

		try {
			const result = await awardDkpMutation.mutateAsync(request)
			toast.success(
				`Successfully awarded ${result.character.newBalance.toLocaleString()} DKP to ${result.character.characterName}`
			)

			// Clear form
			setCharacterId('')
			setCorporationId('')
			setAmount('')
			setReason('')
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Failed to award DKP')
		}
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Single DKP Award</CardTitle>
				<CardDescription>Award DKP to a single character</CardDescription>
			</CardHeader>
			<CardContent>
				<form onSubmit={handleSubmit} className="space-y-4">
					<div className="grid gap-4 md:grid-cols-2">
						<div className="space-y-2">
							<Label htmlFor="characterId">
								Character ID <span className="text-destructive">*</span>
							</Label>
							<Input
								id="characterId"
								type="text"
								placeholder="12345678"
								value={characterId}
								onChange={(e) => setCharacterId(e.target.value)}
								required
							/>
							<p className="text-xs text-muted-foreground">EVE character ID</p>
						</div>

						<div className="space-y-2">
							<Label htmlFor="corporationId">Corporation ID (Optional)</Label>
							<Input
								id="corporationId"
								type="text"
								placeholder="98765432"
								value={corporationId}
								onChange={(e) => setCorporationId(e.target.value)}
							/>
							<p className="text-xs text-muted-foreground">
								Leave blank to auto-detect from character
							</p>
						</div>
					</div>

					<div className="grid gap-4 md:grid-cols-2">
						<div className="space-y-2">
							<Label htmlFor="amount">
								Amount <span className="text-destructive">*</span>
							</Label>
							<Input
								id="amount"
								type="number"
								min="1"
								max="1000000"
								placeholder="100"
								value={amount}
								onChange={(e) => setAmount(e.target.value)}
								required
							/>
							<p className="text-xs text-muted-foreground">Max: 1,000,000</p>
						</div>

						<div className="space-y-2">
							<Label htmlFor="sourceType">
								Source Type <span className="text-destructive">*</span>
							</Label>
							<Select value={sourceType} onValueChange={(val) => setSourceType(val as DkpSourceType)}>
								<SelectTrigger id="sourceType">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="manual">Manual</SelectItem>
									<SelectItem value="fleet">Fleet</SelectItem>
									<SelectItem value="market">Market</SelectItem>
									<SelectItem value="mining">Mining</SelectItem>
									<SelectItem value="adjustment">Adjustment</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>

					<div className="space-y-2">
						<Label htmlFor="reason">
							Reason <span className="text-destructive">*</span>
						</Label>
						<Textarea
							id="reason"
							placeholder="Describe why DKP is being awarded (minimum 10 characters)"
							value={reason}
							onChange={(e) => setReason(e.target.value)}
							rows={3}
							required
							minLength={10}
							maxLength={500}
						/>
						<p className="text-xs text-muted-foreground">
							{reason.length}/500 characters (min: 10)
						</p>
					</div>

					<div className="flex gap-2">
						<Button type="submit" disabled={awardDkpMutation.isPending}>
							{awardDkpMutation.isPending ? 'Awarding...' : 'Award DKP'}
						</Button>
						<Button
							type="button"
							variant="outline"
							onClick={() => {
								setCharacterId('')
								setCorporationId('')
								setAmount('')
								setReason('')
							}}
						>
							Clear
						</Button>
					</div>
				</form>
			</CardContent>
		</Card>
	)
}

function BulkAwardForm() {
	const [bulkInput, setBulkInput] = useState('')
	const [globalReason, setGlobalReason] = useState('')
	const [sourceType, setSourceType] = useState<'fleet' | 'manual'>('manual')

	const awardDkpBulkMutation = useAwardDkpBulk()

	const parsedAwards = bulkInput
		.split('\n')
		.filter((line) => line.trim())
		.map((line) => {
			const parts = line.split(',').map((p) => p.trim())
			return {
				characterId: parts[0] || '',
				amount: Number(parts[1]) || 0,
				reason: parts[2] || undefined,
			}
		})
		.filter((award) => award.characterId && award.amount > 0)

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()

		if (parsedAwards.length === 0) {
			toast.error('No valid awards to process')
			return
		}

		if (!globalReason.trim() || globalReason.trim().length < 10) {
			toast.error('Global reason must be at least 10 characters')
			return
		}

		try {
			const result = await awardDkpBulkMutation.mutateAsync({
				awards: parsedAwards,
				globalReason: globalReason.trim(),
				sourceType,
			})

			toast.success(`Successfully awarded DKP to ${result.totalAwarded} characters`)

			if (result.errors.length > 0) {
				toast.error(`${result.errors.length} awards failed`)
			}

			// Clear form
			setBulkInput('')
			setGlobalReason('')
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Failed to award DKP')
		}
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Bulk DKP Award</CardTitle>
				<CardDescription>Award DKP to multiple characters at once</CardDescription>
			</CardHeader>
			<CardContent>
				<form onSubmit={handleSubmit} className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="bulkInput">
							Awards <span className="text-destructive">*</span>
						</Label>
						<Textarea
							id="bulkInput"
							placeholder="characterId,amount,reason (optional)&#10;12345678,100,Fleet participation&#10;98765432,150"
							value={bulkInput}
							onChange={(e) => setBulkInput(e.target.value)}
							rows={8}
							required
							className="font-mono text-sm"
						/>
						<p className="text-xs text-muted-foreground">
							One award per line: characterId,amount,reason (optional)
						</p>
					</div>

					{parsedAwards.length > 0 && (
						<Card>
							<CardHeader>
								<CardTitle className="text-sm">Preview ({parsedAwards.length} awards)</CardTitle>
							</CardHeader>
							<CardContent>
								<div className="space-y-1 max-h-40 overflow-y-auto">
									{parsedAwards.map((award, index) => (
										<div key={index} className="text-xs font-mono flex items-center gap-2">
											<span className="text-muted-foreground">{index + 1}.</span>
											<span>{award.characterId}</span>
											<span className="text-green-500">+{award.amount}</span>
											{award.reason && (
												<span className="text-muted-foreground">({award.reason})</span>
											)}
										</div>
									))}
								</div>
							</CardContent>
						</Card>
					)}

					<div className="grid gap-4 md:grid-cols-2">
						<div className="space-y-2">
							<Label htmlFor="globalReason">
								Global Reason <span className="text-destructive">*</span>
							</Label>
							<Textarea
								id="globalReason"
								placeholder="Describe why DKP is being awarded"
								value={globalReason}
								onChange={(e) => setGlobalReason(e.target.value)}
								rows={2}
								required
								minLength={10}
								maxLength={500}
							/>
							<p className="text-xs text-muted-foreground">
								{globalReason.length}/500 characters (min: 10)
							</p>
						</div>

						<div className="space-y-2">
							<Label htmlFor="bulkSourceType">
								Source Type <span className="text-destructive">*</span>
							</Label>
							<Select
								value={sourceType}
								onValueChange={(val) => setSourceType(val as 'fleet' | 'manual')}
							>
								<SelectTrigger id="bulkSourceType">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="manual">Manual</SelectItem>
									<SelectItem value="fleet">Fleet</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>

					<div className="flex gap-2">
						<Button type="submit" disabled={awardDkpBulkMutation.isPending || parsedAwards.length === 0}>
							{awardDkpBulkMutation.isPending
								? 'Processing...'
								: `Award DKP to ${parsedAwards.length} Characters`}
						</Button>
						<Button
							type="button"
							variant="outline"
							onClick={() => {
								setBulkInput('')
								setGlobalReason('')
							}}
						>
							Clear
						</Button>
					</div>
				</form>
			</CardContent>
		</Card>
	)
}

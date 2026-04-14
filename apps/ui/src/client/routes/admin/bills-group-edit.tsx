import { ArrowLeft, Users } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NumberInput } from '@/components/ui/number-input'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useGroupBillAggregate, useUpdateGroupBill } from '@/hooks/useBills'
import { usePageTitle } from '@/hooks/usePageTitle'

import type { LateFeeCompounding, LateFeeType, UpdateBillInput } from '@repo/bills'
import { Button } from '@/components/ui/button'

export default function AdminBillsGroupEditPage() {
	const { groupBillId } = useParams<{ groupBillId: string }>()
	const navigate = useNavigate()

	const { data: aggregate, isLoading, error } = useGroupBillAggregate(groupBillId)
	const updateGroupBill = useUpdateGroupBill()

	usePageTitle(aggregate ? `Edit Group Bill - ${aggregate.title}` : 'Edit Group Bill')

	const [formData, setFormData] = useState<{
		title: string
		description: string
		amount: string
		dueDate: string
		enableLateFee: boolean
		lateFeeType: LateFeeType
		lateFeeAmount: string
		lateFeeCompounding: LateFeeCompounding
	}>({
		title: '',
		description: '',
		amount: '',
		dueDate: '',
		enableLateFee: false,
		lateFeeType: 'static',
		lateFeeAmount: '',
		lateFeeCompounding: 'none',
	})

	const [errors, setErrors] = useState<Record<string, string>>({})
	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

	const handleChange = (field: string, value: string | boolean) => {
		setFormData((prev) => ({ ...prev, [field]: value }))
		if (errors[field]) {
			setErrors((prev) => {
				const { [field]: _, ...rest } = prev
				return rest
			})
		}
		if (message) setMessage(null)
	}

	const validate = (): boolean => {
		const newErrors: Record<string, string> = {}

		if (
			formData.amount.trim() &&
			(isNaN(Number(formData.amount)) || Number(formData.amount) <= 0)
		) {
			newErrors.amount = 'Amount must be a positive number'
		}

		if (formData.enableLateFee) {
			if (!formData.lateFeeAmount.trim()) {
				newErrors.lateFeeAmount = 'Late fee amount is required when late fees are enabled'
			} else if (isNaN(Number(formData.lateFeeAmount)) || Number(formData.lateFeeAmount) <= 0) {
				newErrors.lateFeeAmount = 'Late fee amount must be a positive number'
			} else if (formData.lateFeeType === 'percentage' && Number(formData.lateFeeAmount) > 100) {
				newErrors.lateFeeAmount = 'Late fee percentage cannot exceed 100.00%'
			}
		}

		setErrors(newErrors)
		return Object.keys(newErrors).length === 0
	}

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()
		if (!validate()) return

		// Only include fields that were filled in — blank fields are omitted
		const input: UpdateBillInput = {}
		if (formData.title.trim()) input.title = formData.title.trim()
		if (formData.description.trim()) input.description = formData.description.trim()
		if (formData.amount.trim()) input.amount = formData.amount.trim()
		if (formData.dueDate) input.dueDate = new Date(formData.dueDate + 'T00:00:00')
		if (formData.enableLateFee) {
			input.lateFeeType = formData.lateFeeType
			if (formData.lateFeeAmount.trim()) input.lateFeeAmount = formData.lateFeeAmount.trim()
			if (formData.lateFeeType !== 'none') input.lateFeeCompounding = formData.lateFeeCompounding
		}

		if (Object.keys(input).length === 0) {
			setMessage({ type: 'error', text: 'No changes to apply.' })
			return
		}

		try {
			const result = await updateGroupBill.mutateAsync({ groupBillId: groupBillId!, data: input })
			setMessage({
				type: 'success',
				text: `Updated ${result.succeeded} bill(s)${result.skipped > 0 ? `, skipped ${result.skipped}` : ''}.`,
			})
			setTimeout(() => {
				void navigate('/admin/bills')
			}, 1500)
		} catch (err) {
			setMessage({
				type: 'error',
				text: err instanceof Error ? err.message : 'Failed to update group bill',
			})
		}
	}

	if (isLoading) {
		return (
			<div className="space-y-6">
				<div className="flex items-center justify-between">
					<h1 className="text-3xl font-bold gradient-text">Loading...</h1>
					<Button variant="ghost" asChild>
						<Link to="/admin/bills">
							<ArrowLeft className="h-4 w-4" />
							Back to Bills
						</Link>
					</Button>
				</div>
			</div>
		)
	}

	if (error || !aggregate) {
		return (
			<div className="space-y-6">
				<div className="flex items-center justify-between">
					<div>
						<h1 className="text-3xl font-bold gradient-text">Group Bill Not Found</h1>
						<p className="text-muted-foreground mt-2">
							The group bill you're looking for doesn't exist or you don't have permission to view
							it.
						</p>
					</div>
					<Button variant="ghost" asChild>
						<Link to="/admin/bills">
							<ArrowLeft className="h-4 w-4" />
							Back to Bills
						</Link>
					</Button>
				</div>
			</div>
		)
	}

	const eligibleCount = aggregate.bills.filter(
		(b) => b.status !== 'paid' && b.status !== 'cancelled'
	).length

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-3xl font-bold gradient-text">Edit Group Bill</h1>
					<p className="text-muted-foreground mt-2 flex items-center gap-2">
						<Users className="h-4 w-4" />
						{aggregate.title} — {eligibleCount} eligible bill(s) will be updated
					</p>
				</div>
				<Button variant="ghost" asChild>
					<Link to="/admin/bills">
						<ArrowLeft className="h-4 w-4" />
						Back to Bills
					</Link>
				</Button>
			</div>

			<Card className="border-muted bg-muted/20">
				<CardContent className="py-3 text-sm text-muted-foreground">
					Only fields you fill in will be updated. Leave fields blank to keep their current values.
					Paid and cancelled bills will be skipped.
				</CardContent>
			</Card>

			{message && (
				<Card
					className={
						message.type === 'error'
							? 'border-destructive bg-destructive/10'
							: 'border-primary bg-primary/10'
					}
				>
					<CardContent className="py-3">
						<p className={message.type === 'error' ? 'text-destructive' : 'text-primary'}>
							{message.text}
						</p>
					</CardContent>
				</Card>
			)}

			<form onSubmit={handleSubmit}>
				<Card variant="interactive" className="mb-6">
					<CardHeader>
						<CardTitle>Bill Details</CardTitle>
						<CardDescription>Leave blank to keep current values on each bill</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="title">Title</Label>
							<Input
								id="title"
								placeholder="Leave blank to keep current title"
								value={formData.title}
								onChange={(e) => handleChange('title', e.target.value)}
							/>
						</div>

						<div className="space-y-2">
							<Label htmlFor="description">Description</Label>
							<Textarea
								id="description"
								rows={3}
								placeholder="Leave blank to keep current description"
								value={formData.description}
								onChange={(e) => handleChange('description', e.target.value)}
							/>
						</div>

						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							<div className="space-y-2">
								<Label htmlFor="amount">Amount (ISK)</Label>
								<NumberInput
									id="amount"
									min={0}
									suffix=" ISK"
									placeholder="Leave blank to keep current amount"
									value={formData.amount}
									onChange={(value) => handleChange('amount', value)}
									error={!!errors.amount}
								/>
								{errors.amount && <p className="text-sm text-destructive">{errors.amount}</p>}
							</div>

							<div className="space-y-2">
								<Label htmlFor="dueDate">Due Date</Label>
								<Input
									id="dueDate"
									type="date"
									value={formData.dueDate}
									onChange={(e) => handleChange('dueDate', e.target.value)}
								/>
							</div>
						</div>
					</CardContent>
				</Card>

				<Card variant="interactive" className="mb-6">
					<CardHeader>
						<CardTitle>Late Fee Settings</CardTitle>
						<CardDescription>Override late fee settings for all eligible bills</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="flex items-center justify-between">
							<div className="space-y-0.5">
								<Label htmlFor="enableLateFee">Update Late Fees</Label>
								<p className="text-sm text-muted-foreground">
									Override late fee configuration on all eligible bills
								</p>
							</div>
							<Switch
								id="enableLateFee"
								checked={formData.enableLateFee}
								onCheckedChange={(checked) => handleChange('enableLateFee', checked)}
							/>
						</div>

						{formData.enableLateFee && (
							<>
								<div className="space-y-2">
									<Label htmlFor="lateFeeType">Late Fee Type</Label>
									<Select
										inputId="lateFeeType"
										value={formData.lateFeeType}
										onValueChange={(value) => handleChange('lateFeeType', value)}
										options={[
											{ value: 'static', label: 'Static Amount (Fixed ISK)' },
											{ value: 'percentage', label: 'Percentage (% of bill amount)' },
										]}
									/>
								</div>

								<div className="space-y-2">
									<Label htmlFor="lateFeeAmount">
										Late Fee Amount {formData.lateFeeType === 'percentage' ? '(%)' : '(ISK)'}{' '}
										<span className="text-destructive">*</span>
									</Label>
									{formData.lateFeeType === 'percentage' ? (
										<NumberInput
											id="lateFeeAmount"
											min={0}
											max={100}
											decimalScale={2}
											fixedDecimalScale
											suffix="%"
											value={formData.lateFeeAmount}
											onChange={(value) => handleChange('lateFeeAmount', value)}
											error={!!errors.lateFeeAmount}
										/>
									) : (
										<NumberInput
											id="lateFeeAmount"
											min={0}
											suffix=" ISK"
											value={formData.lateFeeAmount}
											onChange={(value) => handleChange('lateFeeAmount', value)}
											error={!!errors.lateFeeAmount}
										/>
									)}
									{errors.lateFeeAmount && (
										<p className="text-sm text-destructive">{errors.lateFeeAmount}</p>
									)}
								</div>

								<div className="space-y-2">
									<Label htmlFor="lateFeeCompounding">Late Fee Compounding</Label>
									<Select
										inputId="lateFeeCompounding"
										value={formData.lateFeeCompounding}
										onValueChange={(value) => handleChange('lateFeeCompounding', value)}
										options={[
											{ value: 'none', label: 'None (One-time fee)' },
											{ value: 'daily', label: 'Daily (Compounds every day)' },
											{ value: 'weekly', label: 'Weekly (Compounds every week)' },
											{ value: 'monthly', label: 'Monthly (Compounds every month)' },
										]}
									/>
								</div>
							</>
						)}
					</CardContent>
				</Card>

				<div className="flex gap-3">
					<Button variant="confirm" type="submit" loading={updateGroupBill.isPending}>
						Apply to All Eligible Bills
					</Button>
					<Button variant="cancel" type="button" onClick={() => navigate('/admin/bills')}>
						Cancel
					</Button>
				</div>
			</form>
		</div>
	)
}

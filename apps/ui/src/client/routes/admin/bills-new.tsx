import { FileText } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { CancelButton } from '@/components/ui/cancel-button'
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
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useCreateBill } from '@/hooks/useBills'
import { usePageTitle } from '@/hooks/usePageTitle'

import type { CreateBillInput, EntityType, LateFeeCompounding, LateFeeType } from '@repo/bills'

export default function AdminBillsNewPage() {
	usePageTitle('Admin - Create Bill')

	const navigate = useNavigate()
	const createBill = useCreateBill()

	const [formData, setFormData] = useState<{
		payerId: string
		payerType: EntityType
		title: string
		description: string
		amount: string
		dueDate: string
		enableLateFee: boolean
		lateFeeType: LateFeeType
		lateFeeAmount: string
		lateFeeCompounding: LateFeeCompounding
	}>({
		payerId: '',
		payerType: 'character',
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
		// Clear error when field is edited
		if (errors[field]) {
			setErrors((prev) => {
				const { [field]: _, ...rest } = prev
				return rest
			})
		}
		// Clear general message
		if (message) setMessage(null)
	}

	const validate = (): boolean => {
		const newErrors: Record<string, string> = {}

		if (!formData.payerId.trim()) {
			newErrors.payerId = 'Payer ID is required'
		}

		if (!formData.title.trim()) {
			newErrors.title = 'Title is required'
		}

		if (!formData.amount.trim()) {
			newErrors.amount = 'Amount is required'
		} else if (isNaN(Number(formData.amount)) || Number(formData.amount) <= 0) {
			newErrors.amount = 'Amount must be a positive number'
		}

		if (!formData.dueDate) {
			newErrors.dueDate = 'Due date is required'
		} else {
			const dueDate = new Date(formData.dueDate)
			const today = new Date()
			today.setHours(0, 0, 0, 0)
			if (dueDate < today) {
				newErrors.dueDate = 'Due date must be today or in the future'
			}
		}

		if (formData.enableLateFee) {
			if (!formData.lateFeeAmount.trim()) {
				newErrors.lateFeeAmount = 'Late fee amount is required when late fees are enabled'
			} else if (
				isNaN(Number(formData.lateFeeAmount)) ||
				Number(formData.lateFeeAmount) < 0
			) {
				newErrors.lateFeeAmount = 'Late fee amount must be a non-negative number'
			}
		}

		setErrors(newErrors)
		return Object.keys(newErrors).length === 0
	}

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()

		if (!validate()) {
			return
		}

		try {
			const input: CreateBillInput = {
				payerId: formData.payerId.trim(),
				payerType: formData.payerType,
				title: formData.title.trim(),
				description: formData.description.trim() || undefined,
				amount: formData.amount.trim(),
				dueDate: new Date(formData.dueDate),
				lateFeeType: formData.enableLateFee ? formData.lateFeeType : 'none',
				lateFeeAmount:
					formData.enableLateFee && formData.lateFeeAmount.trim()
						? formData.lateFeeAmount.trim()
						: undefined,
				lateFeeCompounding:
					formData.enableLateFee && formData.lateFeeType !== 'none'
						? formData.lateFeeCompounding
						: undefined,
			}

			await createBill.mutateAsync(input)
			setMessage({ type: 'success', text: 'Bill created successfully!' })
			setTimeout(() => {
				navigate('/admin/bills')
			}, 1500)
		} catch (error) {
			console.error('Failed to create bill:', error)
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to create bill',
			})
		}
	}

	return (
		<div className="space-y-6">
			{/* Page Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-3xl font-bold gradient-text">Create Bill</h1>
					<p className="text-muted-foreground mt-2">
						Create a new bill for a character, corporation, or group
					</p>
				</div>
				<Button variant="outline" asChild>
					<Link to="/admin/bills">
						<FileText className="mr-2 h-4 w-4" />
						Back to Bills
					</Link>
				</Button>
			</div>

			{/* Success/Error Message */}
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
				{/* Payer Information */}
				<Card variant="interactive" className="mb-6">
					<CardHeader>
						<CardTitle>Payer Information</CardTitle>
						<CardDescription>Who is responsible for paying this bill?</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							<div className="space-y-2">
								<Label htmlFor="payerType">
									Payer Type <span className="text-destructive">*</span>
								</Label>
								<Select
									value={formData.payerType}
									onValueChange={(value) => handleChange('payerType', value)}
								>
									<SelectTrigger id="payerType">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="character">Character</SelectItem>
										<SelectItem value="corporation">Corporation</SelectItem>
										<SelectItem value="group">Group</SelectItem>
									</SelectContent>
								</Select>
							</div>

							<div className="space-y-2">
								<Label htmlFor="payerId">
									Payer ID <span className="text-destructive">*</span>
								</Label>
								<Input
									id="payerId"
									placeholder={`${
										formData.payerType === 'character'
											? 'Character'
											: formData.payerType === 'corporation'
												? 'Corporation'
												: 'Group'
									} ID`}
									value={formData.payerId}
									onChange={(e) => handleChange('payerId', e.target.value)}
									className={errors.payerId ? 'border-destructive' : ''}
								/>
								{errors.payerId && (
									<p className="text-sm text-destructive">{errors.payerId}</p>
								)}
								<p className="text-sm text-muted-foreground">
									Enter the EVE Online {formData.payerType} ID or group ID
								</p>
							</div>
						</div>
					</CardContent>
				</Card>

				{/* Bill Details */}
				<Card variant="interactive" className="mb-6">
					<CardHeader>
						<CardTitle>Bill Details</CardTitle>
						<CardDescription>
							Enter the amount and description for this bill
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="title">
								Title <span className="text-destructive">*</span>
							</Label>
							<Input
								id="title"
								placeholder="e.g., Monthly Alliance Dues"
								value={formData.title}
								onChange={(e) => handleChange('title', e.target.value)}
								className={errors.title ? 'border-destructive' : ''}
							/>
							{errors.title && <p className="text-sm text-destructive">{errors.title}</p>}
						</div>

						<div className="space-y-2">
							<Label htmlFor="description">Description</Label>
							<Textarea
								id="description"
								placeholder="Optional description explaining what this bill is for..."
								rows={3}
								value={formData.description}
								onChange={(e) => handleChange('description', e.target.value)}
							/>
							<p className="text-sm text-muted-foreground">
								Provide additional context about this bill (optional)
							</p>
						</div>

						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							<div className="space-y-2">
								<Label htmlFor="amount">
									Amount (ISK) <span className="text-destructive">*</span>
								</Label>
								<Input
									id="amount"
									type="text"
									placeholder="1000000"
									value={formData.amount}
									onChange={(e) => handleChange('amount', e.target.value)}
									className={errors.amount ? 'border-destructive' : ''}
								/>
								{errors.amount && (
									<p className="text-sm text-destructive">{errors.amount}</p>
								)}
							</div>

							<div className="space-y-2">
								<Label htmlFor="dueDate">
									Due Date <span className="text-destructive">*</span>
								</Label>
								<Input
									id="dueDate"
									type="date"
									value={formData.dueDate}
									onChange={(e) => handleChange('dueDate', e.target.value)}
									className={errors.dueDate ? 'border-destructive' : ''}
								/>
								{errors.dueDate && (
									<p className="text-sm text-destructive">{errors.dueDate}</p>
								)}
							</div>
						</div>
					</CardContent>
				</Card>

				{/* Late Fee Settings */}
				<Card variant="interactive" className="mb-6">
					<CardHeader>
						<CardTitle>Late Fee Settings</CardTitle>
						<CardDescription>
							Configure penalties for late payment (optional)
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="flex items-center justify-between">
							<div className="space-y-0.5">
								<Label htmlFor="enableLateFee">Enable Late Fees</Label>
								<p className="text-sm text-muted-foreground">
									Charge additional fees for late payment
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
										value={formData.lateFeeType}
										onValueChange={(value) => handleChange('lateFeeType', value)}
									>
										<SelectTrigger id="lateFeeType">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="static">
												Static Amount (Fixed ISK)
											</SelectItem>
											<SelectItem value="percentage">
												Percentage (% of bill amount)
											</SelectItem>
										</SelectContent>
									</Select>
								</div>

								<div className="space-y-2">
									<Label htmlFor="lateFeeAmount">
										Late Fee Amount{' '}
										{formData.lateFeeType === 'percentage' ? '(%)' : '(ISK)'}{' '}
										<span className="text-destructive">*</span>
									</Label>
									<Input
										id="lateFeeAmount"
										type="text"
										placeholder={
											formData.lateFeeType === 'percentage' ? '5' : '10000'
										}
										value={formData.lateFeeAmount}
										onChange={(e) => handleChange('lateFeeAmount', e.target.value)}
										className={errors.lateFeeAmount ? 'border-destructive' : ''}
									/>
									{errors.lateFeeAmount && (
										<p className="text-sm text-destructive">
											{errors.lateFeeAmount}
										</p>
									)}
								</div>

								<div className="space-y-2">
									<Label htmlFor="lateFeeCompounding">
										Late Fee Compounding
									</Label>
									<Select
										value={formData.lateFeeCompounding}
										onValueChange={(value) =>
											handleChange('lateFeeCompounding', value)
										}
									>
										<SelectTrigger id="lateFeeCompounding">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="none">
												None (One-time fee)
											</SelectItem>
											<SelectItem value="daily">
												Daily (Compounds every day)
											</SelectItem>
											<SelectItem value="weekly">
												Weekly (Compounds every week)
											</SelectItem>
											<SelectItem value="monthly">
												Monthly (Compounds every month)
											</SelectItem>
										</SelectContent>
									</Select>
									<p className="text-sm text-muted-foreground">
										How often the late fee should be applied after the due date
									</p>
								</div>
							</>
						)}
					</CardContent>
				</Card>

				{/* Actions */}
				<div className="flex gap-3">
					<Button type="submit" disabled={createBill.isPending}>
						{createBill.isPending ? 'Creating Bill...' : 'Create Bill'}
					</Button>
					<CancelButton type="button" onClick={() => navigate('/admin/bills')}>
						Cancel
					</CancelButton>
				</div>
			</form>
		</div>
	)
}

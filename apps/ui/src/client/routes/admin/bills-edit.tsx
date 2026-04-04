import { ArrowLeft } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NumberInput } from '@/components/ui/number-input'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useBill, useUpdateBill } from '@/hooks/useBills'
import { usePageTitle } from '@/hooks/usePageTitle'

import type { LateFeeCompounding, LateFeeType, UpdateBillInput } from '@repo/bills'
import { Button } from '@/components/ui/button'

export default function AdminBillsEditPage() {
	const { billId } = useParams<{ billId: string }>()
	const navigate = useNavigate()

	const { data: bill, isLoading, error } = useBill(billId!)
	const updateBill = useUpdateBill()

	usePageTitle(bill ? `Edit Bill - ${bill.title}` : 'Edit Bill')

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

	// Populate form when bill loads
	useEffect(() => {
		if (!bill) return
		const dueDate = bill.dueDate ? new Date(bill.dueDate).toISOString().split('T')[0] : ''
		const hasLateFee = bill.lateFeeType != null && bill.lateFeeType !== 'none'
		setFormData({
			title: bill.title ?? '',
			description: bill.description ?? '',
			amount: bill.amount ?? '',
			dueDate,
			enableLateFee: hasLateFee,
			lateFeeType: (bill.lateFeeType as LateFeeType | null) ?? 'static',
			lateFeeAmount: bill.lateFeeAmount ?? '',
			lateFeeCompounding: (bill.lateFeeCompounding as LateFeeCompounding | null) ?? 'none',
		})
	}, [bill])

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

		try {
			const input: UpdateBillInput = {
				title: formData.title.trim(),
				description: formData.description.trim() || undefined,
				amount: formData.amount.trim(),
				dueDate: new Date(formData.dueDate + 'T00:00:00'),
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

			await updateBill.mutateAsync({ id: billId!, data: input })
			setMessage({ type: 'success', text: 'Bill updated successfully!' })
			setTimeout(() => {
				void navigate(`/admin/bills/${billId}`)
			}, 1000)
		} catch (err) {
			setMessage({
				type: 'error',
				text: err instanceof Error ? err.message : 'Failed to update bill',
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
							<ArrowLeft className="mr-2 h-4 w-4" />
							Back to Bills
						</Link>
					</Button>
				</div>
			</div>
		)
	}

	if (error || !bill) {
		return (
			<div className="space-y-6">
				<div className="flex items-center justify-between">
					<div>
						<h1 className="text-3xl font-bold gradient-text">Bill Not Found</h1>
						<p className="text-muted-foreground mt-2">
							The bill you're looking for doesn't exist or you don't have permission to view it.
						</p>
					</div>
					<Button variant="ghost" asChild>
						<Link to="/admin/bills">
							<ArrowLeft className="mr-2 h-4 w-4" />
							Back to Bills
						</Link>
					</Button>
				</div>
			</div>
		)
	}

	if (bill.status !== 'draft') {
		return (
			<div className="space-y-6">
				<div className="flex items-center justify-between">
					<div>
						<h1 className="text-3xl font-bold gradient-text">Cannot Edit Bill</h1>
						<p className="text-muted-foreground mt-2">
							Only draft bills can be edited. This bill has status: <strong>{bill.status}</strong>.
						</p>
					</div>
					<Button variant="ghost" asChild>
						<Link to={`/admin/bills/${billId}`}>
							<ArrowLeft className="mr-2 h-4 w-4" />
							Back to Bill
						</Link>
					</Button>
				</div>
			</div>
		)
	}

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-3xl font-bold gradient-text">Edit Bill</h1>
					<p className="text-muted-foreground mt-2">{bill.title}</p>
				</div>
				<Button variant="ghost" asChild>
					<Link to={`/admin/bills/${billId}`}>
						<ArrowLeft className="mr-2 h-4 w-4" />
						Back to Bill
					</Link>
				</Button>
			</div>

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
						<CardDescription>Update the bill title, amount, and due date</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="title">
								Title <span className="text-destructive">*</span>
							</Label>
							<Input
								id="title"
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
								rows={3}
								value={formData.description}
								onChange={(e) => handleChange('description', e.target.value)}
							/>
						</div>

						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							<div className="space-y-2">
								<Label htmlFor="amount">
									Amount (ISK) <span className="text-destructive">*</span>
								</Label>
								<NumberInput
									id="amount"
									min={0}
									suffix=" ISK"
									value={formData.amount}
									onChange={(value) => handleChange('amount', value)}
									error={!!errors.amount}
								/>
								{errors.amount && <p className="text-sm text-destructive">{errors.amount}</p>}
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
								{errors.dueDate && <p className="text-sm text-destructive">{errors.dueDate}</p>}
							</div>
						</div>
					</CardContent>
				</Card>

				<Card variant="interactive" className="mb-6">
					<CardHeader>
						<CardTitle>Late Fee Settings</CardTitle>
						<CardDescription>Configure penalties for late payment (optional)</CardDescription>
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
					<Button variant="confirm" type="submit" loading={updateBill.isPending}>
						Save Changes
					</Button>
					<Button variant="cancel" type="button" onClick={() => navigate(`/admin/bills/${billId}`)}>
						Cancel
					</Button>
				</div>
			</form>
		</div>
	)
}

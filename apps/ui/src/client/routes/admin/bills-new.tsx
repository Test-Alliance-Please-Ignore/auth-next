import { ArrowLeft } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'

import { BillEntityPicker } from '@/components/bills/bill-entity-picker'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NumberInput } from '@/components/ui/number-input'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useBillEntitySearch, useCreateBill } from '@/hooks/useBills'
import { useDebounce } from '@/hooks/useDebounce'
import { usePageTitle } from '@/hooks/usePageTitle'

import type {
	Bill,
	CreateBillInput,
	EntityType,
	LateFeeCompounding,
	LateFeeType,
	PayeeType,
} from '@repo/bills'

export default function AdminBillsNewPage() {
	usePageTitle('Admin - Create Bill')

	const navigate = useNavigate()
	const createBill = useCreateBill()

	const [formData, setFormData] = useState<{
		payerId: string
		payerType: EntityType
		payeeId: string
		payeeType: PayeeType
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
		payeeId: '',
		payeeType: 'character',
		title: '',
		description: '',
		amount: '',
		dueDate: '',
		enableLateFee: false,
		lateFeeType: 'static',
		lateFeeAmount: '',
		lateFeeCompounding: 'none',
	})

	const [groupBillOptions, setGroupBillOptions] = useState({
		includeOwner: true,
		includeAdmins: true,
		includeMembers: true,
	})

	const [errors, setErrors] = useState<Record<string, string>>({})
	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
	const [payerQuery, setPayerQuery] = useState('')
	const [payeeQuery, setPayeeQuery] = useState('')
	const [payerName, setPayerName] = useState('')
	const [payeeName, setPayeeName] = useState('')
	const debouncedPayerQuery = useDebounce(payerQuery, 300)
	const debouncedPayeeQuery = useDebounce(payeeQuery, 300)
	const payerEntitySearch = useBillEntitySearch({
		q: debouncedPayerQuery,
		entityType: formData.payerType,
		enabled: debouncedPayerQuery.trim().length >= 2,
	})
	const payeeEntitySearch = useBillEntitySearch({
		q: debouncedPayeeQuery,
		entityType: formData.payeeType,
		enabled: debouncedPayeeQuery.trim().length >= 2,
	})
	const payerOptions = useMemo(() => {
		const deduped = new Map<string, { value: string; label: string; description: string }>()
		for (const row of payerEntitySearch.data ?? []) {
			const key = row.entityId
			if (!deduped.has(key)) {
				deduped.set(key, {
					value: row.entityId,
					label: row.name || row.entityId,
					description: row.entityId,
				})
			}
		}
		return [...deduped.values()]
	}, [payerEntitySearch.data])
	const payeeOptions = useMemo(() => {
		const deduped = new Map<string, { value: string; label: string; description: string }>()
		for (const row of payeeEntitySearch.data ?? []) {
			const key = row.entityId
			if (!deduped.has(key)) {
				deduped.set(key, {
					value: row.entityId,
					label: row.name || row.entityId,
					description: row.entityId,
				})
			}
		}
		return [...deduped.values()]
	}, [payeeEntitySearch.data])

	const handleChange = (field: string, value: string | boolean) => {
		setFormData((prev) => ({ ...prev, [field]: value }))
		if (field === 'payerType') {
			setPayerQuery('')
			setPayerName('')
			setFormData((prev) => ({ ...prev, payerId: '' }))
		}
		if (field === 'payeeType') {
			setPayeeQuery('')
			setPayeeName('')
			setFormData((prev) => ({ ...prev, payeeId: '' }))
		}
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
			newErrors.payerId = 'Payer is required'
		}

		if (!formData.payeeId.trim()) {
			newErrors.payeeId = 'Payee is required'
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
			// Append T00:00:00 so the date is interpreted as local midnight rather than UTC midnight.
			// Without this, new Date("2026-03-26") is UTC midnight which falls before local midnight
			// for users west of UTC, causing today's date to be incorrectly rejected.
			const dueDate = new Date(formData.dueDate + 'T00:00:00')
			const today = new Date()
			today.setHours(0, 0, 0, 0)
			if (dueDate < today) {
				newErrors.dueDate = 'Due date must be today or in the future'
			}
		}

		if (formData.payerType === 'group') {
			if (
				!groupBillOptions.includeOwner &&
				!groupBillOptions.includeAdmins &&
				!groupBillOptions.includeMembers
			) {
				newErrors.groupBillOptions = 'At least one member role must be selected'
			}
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

		if (!validate()) {
			return
		}

		try {
			const input: CreateBillInput & {
				groupBillOptions?: {
					includeOwner: boolean
					includeAdmins: boolean
					includeMembers: boolean
				}
			} = {
				payerId: formData.payerId.trim(),
				payerType: formData.payerType,
				payeeId: formData.payeeId.trim(),
				payeeType: formData.payeeType,
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
				...(formData.payerType === 'group' && { groupBillOptions }),
			}

			const result = await createBill.mutateAsync(input)

			// Group bill returns { groupBillId, bills, billCount }; navigate to group aggregate view
			if ('bills' in result) {
				const groupResult = result as { groupBillId: string; bills: Bill[]; billCount: number }
				setMessage({
					type: 'success',
					text: `Group bill created — ${groupResult.billCount} individual bills issued.`,
				})
				setTimeout(() => {
					navigate(`/admin/bills/group/${encodeURIComponent(groupResult.groupBillId)}`)
				}, 1500)
			} else {
				setMessage({ type: 'success', text: 'Bill created successfully!' })
				setTimeout(() => {
					navigate('/admin/bills')
				}, 1500)
			}
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
				<Button variant="ghost" asChild>
					<Link to="/admin/bills">
						<ArrowLeft className="h-4 w-4" />
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
				<Card className="mb-6">
					<CardHeader>
						<CardTitle>Payer Information</CardTitle>
						<CardDescription>Who is responsible for paying this bill?</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<BillEntityPicker
							roleLabel="Payer"
							typeFieldId="payerType"
							entityFieldId="payerId"
							entityType={formData.payerType}
							allowedEntityTypes={['character', 'corporation', 'group']}
							onEntityTypeChange={(value) => handleChange('payerType', value)}
							query={payerQuery}
							onQueryChange={setPayerQuery}
							options={payerOptions}
							onEntitySelect={(entityId, name) => {
								handleChange('payerId', entityId)
								setPayerName(name)
							}}
							loading={payerEntitySearch.isLoading}
							selectedEntityId={formData.payerId}
							selectedEntityName={payerName}
							error={errors.payerId}
						/>
					</CardContent>
				</Card>

				{/* Group Bill Options — shown only when payer type is group */}
				{formData.payerType === 'group' && (
					<Card className="mb-6">
						<CardHeader>
							<CardTitle>Group Bill Options</CardTitle>
							<CardDescription>
								Select which member roles to issue individual bills to
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="flex items-center justify-between">
								<div className="space-y-0.5">
									<Label htmlFor="includeOwner">Include Group Owner</Label>
									<p className="text-sm text-muted-foreground">Issue a bill to the group owner</p>
								</div>
								<Switch
									id="includeOwner"
									checked={groupBillOptions.includeOwner}
									onCheckedChange={(checked) =>
										setGroupBillOptions((prev) => ({ ...prev, includeOwner: checked }))
									}
								/>
							</div>
							<div className="flex items-center justify-between">
								<div className="space-y-0.5">
									<Label htmlFor="includeAdmins">Include Group Admins</Label>
									<p className="text-sm text-muted-foreground">Issue bills to all group admins</p>
								</div>
								<Switch
									id="includeAdmins"
									checked={groupBillOptions.includeAdmins}
									onCheckedChange={(checked) =>
										setGroupBillOptions((prev) => ({ ...prev, includeAdmins: checked }))
									}
								/>
							</div>
							<div className="flex items-center justify-between">
								<div className="space-y-0.5">
									<Label htmlFor="includeMembers">Include Group Members</Label>
									<p className="text-sm text-muted-foreground">
										Issue bills to all regular group members
									</p>
								</div>
								<Switch
									id="includeMembers"
									checked={groupBillOptions.includeMembers}
									onCheckedChange={(checked) =>
										setGroupBillOptions((prev) => ({ ...prev, includeMembers: checked }))
									}
								/>
							</div>
							{errors.groupBillOptions && (
								<p className="text-sm text-destructive">{errors.groupBillOptions}</p>
							)}
						</CardContent>
					</Card>
				)}

				{/* Payee Information */}
				<Card className="mb-6">
					<CardHeader>
						<CardTitle>Payee Information</CardTitle>
						<CardDescription>Who will receive the payment?</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<BillEntityPicker
							roleLabel="Payee"
							typeFieldId="payeeType"
							entityFieldId="payeeId"
							entityType={formData.payeeType}
							allowedEntityTypes={['character', 'corporation']}
							onEntityTypeChange={(value) => handleChange('payeeType', value)}
							query={payeeQuery}
							onQueryChange={setPayeeQuery}
							options={payeeOptions}
							onEntitySelect={(entityId, name) => {
								handleChange('payeeId', entityId)
								setPayeeName(name)
							}}
							loading={payeeEntitySearch.isLoading}
							selectedEntityId={formData.payeeId}
							selectedEntityName={payeeName}
							error={errors.payeeId}
						/>
					</CardContent>
				</Card>

				{/* Bill Details */}
				<Card className="mb-6">
					<CardHeader>
						<CardTitle>Bill Details</CardTitle>
						<CardDescription>Enter the amount and description for this bill</CardDescription>
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
								<NumberInput
									id="amount"
									min={0}
									suffix=" ISK"
									placeholder="1,000,000 ISK"
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

				{/* Late Fee Settings */}
				<Card className="mb-6">
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
											placeholder="5.00"
											value={formData.lateFeeAmount}
											onChange={(value) => handleChange('lateFeeAmount', value)}
											error={!!errors.lateFeeAmount}
										/>
									) : (
										<NumberInput
											id="lateFeeAmount"
											min={0}
											suffix=" ISK"
											placeholder="1,000,000 ISK"
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
					<Button variant="confirm" type="submit" loading={createBill.isPending}>
						Create Bill
					</Button>
					<Button variant="cancel" type="button" onClick={() => navigate('/admin/bills')}>
						Cancel
					</Button>
				</div>
			</form>
		</div>
	)
}

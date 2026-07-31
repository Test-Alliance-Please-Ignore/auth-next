import { Calendar, Clock } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'

import { BillEntityPicker } from '@/components/bills/bill-entity-picker'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NumberInput } from '@/components/ui/number-input'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useBillEntitySearch, useCreateSchedule, useTemplates } from '@/hooks/useBills'
import { useDebounce } from '@/hooks/useDebounce'
import { usePageTitle } from '@/hooks/usePageTitle'
import { formatScheduleFrequency } from '@/lib/bills-utils'

import type { CreateScheduleInput, EntityType, PayeeType, ScheduleFrequency } from '@repo/bills'
import { Button } from '@/components/ui/button'

const MS_PER_DAY = 86_400_000

export default function AdminBillsSchedulesNewPage() {
	usePageTitle('Admin - Create Bill Schedule')

	const navigate = useNavigate()
	const createSchedule = useCreateSchedule()
	const { data: templates, isLoading: isLoadingTemplates } = useTemplates()

	const [formData, setFormData] = useState<{
		templateId: string
		payerId: string
		payerType: EntityType
		payeeId: string
		payeeType: PayeeType
		frequency: ScheduleFrequency
		amount: string
		startDate: string
	}>({
		templateId: '',
		payerId: '',
		payerType: 'character',
		payeeId: '',
		payeeType: 'character',
		frequency: 'monthly',
		amount: '',
		startDate: '',
	})

	const [errors, setErrors] = useState<Record<string, string>>({})
	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
	const [groupBillOptions, setGroupBillOptions] = useState({
		includeOwner: true,
		includeAdmins: true,
		includeMembers: true,
	})
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

	// Calculate next generation time preview
	const nextGenerationTime = useMemo(() => {
		// Bill schedules fire at midnight UTC. Bare YYYY-MM-DD strings parse as UTC midnight,
		// which is the correct scheduled time.
		const baseDate = formData.startDate ? new Date(formData.startDate) : new Date()

		switch (formData.frequency) {
			case 'daily':
				return new Date(baseDate.getTime() + MS_PER_DAY)
			case 'weekly':
				return new Date(baseDate.getTime() + 7 * MS_PER_DAY)
			case 'monthly': {
				// Use UTC methods so month arithmetic stays in UTC regardless of the
				// browser's local timezone. setMonth/getMonth operate in local time and
				// would produce the wrong UTC date for users west of UTC.
				const nextMonth = new Date(baseDate)
				nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1)
				return nextMonth
			}
			default:
				return baseDate
		}
	}, [formData.frequency, formData.startDate])

	const handleChange = (field: string, value: string) => {
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

		if (!formData.templateId) {
			newErrors.templateId = 'Template is required'
		}

		if (!formData.payerId.trim()) {
			newErrors.payerId = 'Payer ID is required'
		}
		if (!formData.payeeId.trim()) {
			newErrors.payeeId = 'Payee ID is required'
		}

		if (!formData.amount.trim()) {
			newErrors.amount = 'Amount is required'
		} else if (isNaN(Number(formData.amount)) || Number(formData.amount) <= 0) {
			newErrors.amount = 'Amount must be a positive number'
		}

		if (formData.startDate) {
			// Append T00:00:00 so the date is interpreted as local midnight rather than UTC midnight.
			// Without this, new Date("2026-03-26") is UTC midnight which falls before local midnight
			// for users west of UTC, causing today's date to be incorrectly rejected.
			const startDate = new Date(formData.startDate + 'T00:00:00')
			const now = new Date()
			now.setHours(0, 0, 0, 0)
			if (startDate < now) {
				newErrors.startDate = 'Start date cannot be in the past'
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

		setErrors(newErrors)
		return Object.keys(newErrors).length === 0
	}

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()

		if (!validate()) {
			return
		}

		try {
			const input: CreateScheduleInput = {
				templateId: formData.templateId,
				payerId: formData.payerId.trim(),
				payerType: formData.payerType,
				payeeId: formData.payeeId.trim(),
				payeeType: formData.payeeType,
				frequency: formData.frequency,
				amount: formData.amount.trim(),
				startDate: formData.startDate ? new Date(formData.startDate) : undefined,
				...(formData.payerType === 'group' && {
					groupBillIncludeOwner: groupBillOptions.includeOwner,
					groupBillIncludeAdmins: groupBillOptions.includeAdmins,
					groupBillIncludeMembers: groupBillOptions.includeMembers,
				}),
			}

			await createSchedule.mutateAsync(input)
			setMessage({ type: 'success', text: 'Schedule created successfully!' })
			setTimeout(() => {
				navigate('/admin/bills/schedules')
			}, 1500)
		} catch (error) {
			console.error('Failed to create schedule:', error)
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to create schedule',
			})
		}
	}

	const selectedTemplate = templates?.find((t) => t.id === formData.templateId)

	return (
		<div className="space-y-6">
			{/* Page Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-3xl font-bold gradient-text">Create Bill Schedule</h1>
					<p className="text-muted-foreground mt-2">Set up automated recurring bill generation</p>
				</div>
				<Button variant="ghost" asChild>
					<Link to="/admin/bills/schedules">
						<Calendar className="h-4 w-4" />
						Back to Schedules
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
				{/* Schedule Configuration */}
				<Card className="mb-6">
					<CardHeader>
						<CardTitle>Schedule Configuration</CardTitle>
						<CardDescription>Configure how and when bills should be generated</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="templateId">
								Bill Template <span className="text-destructive">*</span>
							</Label>
							<Select
								inputId="templateId"
								value={formData.templateId}
								onValueChange={(value) => handleChange('templateId', value)}
								placeholder={
									isLoadingTemplates
										? 'Loading templates...'
										: !templates || templates.length === 0
											? 'No templates available'
											: 'Select a template...'
								}
								disabled={isLoadingTemplates || !templates || templates.length === 0}
								inputClassName={errors.templateId ? 'border-destructive' : undefined}
								options={(templates ?? []).map((template) => ({
									value: template.id,
									label: template.name,
								}))}
							/>
							{errors.templateId && <p className="text-sm text-destructive">{errors.templateId}</p>}
							{selectedTemplate && (
								<div className="text-sm text-muted-foreground">
									<p>Template: {selectedTemplate.titleTemplate}</p>
									{selectedTemplate.description && (
										<p className="mt-1">{selectedTemplate.description}</p>
									)}
								</div>
							)}
						</div>

						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							<div className="space-y-2">
								<Label htmlFor="frequency">
									Frequency <span className="text-destructive">*</span>
								</Label>
								<Select
									inputId="frequency"
									value={formData.frequency}
									onValueChange={(value) => handleChange('frequency', value)}
									options={[
										{ value: 'daily', label: 'Daily' },
										{ value: 'weekly', label: 'Weekly' },
										{ value: 'monthly', label: 'Monthly' },
									]}
								/>
								<p className="text-sm text-muted-foreground">How often bills should be generated</p>
							</div>

							<div className="space-y-2">
								<Label htmlFor="startDate">Start Date (Optional)</Label>
								<Input
									id="startDate"
									type="date"
									value={formData.startDate}
									onChange={(e) => handleChange('startDate', e.target.value)}
									className={errors.startDate ? 'border-destructive' : ''}
								/>
								{errors.startDate && <p className="text-sm text-destructive">{errors.startDate}</p>}
								<p className="text-sm text-muted-foreground">
									When to start generating bills (defaults to now)
								</p>
							</div>
						</div>

						{/* Next Generation Preview */}
						<div className="rounded-md bg-muted/50 p-4 border border-border">
							<div className="flex items-start gap-2">
								<Clock className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
								<div className="text-sm">
									<p className="font-medium mb-1">Next Generation Time:</p>
									<p className="text-muted-foreground">
										{nextGenerationTime.toLocaleString('en-US', {
											dateStyle: 'full',
											timeStyle: 'short',
											timeZone: 'UTC',
										})}{' '}
										UTC
									</p>
									<p className="text-muted-foreground mt-1">
										Bills will be generated{' '}
										{formatScheduleFrequency(formData.frequency).toLowerCase()} starting from{' '}
										{formData.startDate ? 'the specified date' : 'now'}
									</p>
								</div>
							</div>
						</div>
					</CardContent>
				</Card>

				{/* Payer/Payee Information */}
				<Card className="mb-6">
					<CardHeader>
						<CardTitle>Parties</CardTitle>
						<CardDescription>Set payer and payee for generated schedule bills</CardDescription>
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

				{/* Group Bill Options */}
				{formData.payerType === 'group' && (
					<Card className="mb-6">
						<CardHeader>
							<CardTitle>Group Bill Options</CardTitle>
							<CardDescription>
								Select which member roles to issue individual bills to on each execution
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							{errors.groupBillOptions && (
								<p className="text-sm text-destructive">{errors.groupBillOptions}</p>
							)}
							<div className="flex items-center justify-between">
								<div className="space-y-0.5">
									<Label htmlFor="sched-includeOwner">Include Group Owner</Label>
									<p className="text-sm text-muted-foreground">Issue a bill to the group owner</p>
								</div>
								<Switch
									id="sched-includeOwner"
									checked={groupBillOptions.includeOwner}
									onCheckedChange={(checked) =>
										setGroupBillOptions((prev) => ({ ...prev, includeOwner: checked }))
									}
								/>
							</div>
							<div className="flex items-center justify-between">
								<div className="space-y-0.5">
									<Label htmlFor="sched-includeAdmins">Include Group Admins</Label>
									<p className="text-sm text-muted-foreground">Issue bills to all group admins</p>
								</div>
								<Switch
									id="sched-includeAdmins"
									checked={groupBillOptions.includeAdmins}
									onCheckedChange={(checked) =>
										setGroupBillOptions((prev) => ({ ...prev, includeAdmins: checked }))
									}
								/>
							</div>
							<div className="flex items-center justify-between">
								<div className="space-y-0.5">
									<Label htmlFor="sched-includeMembers">Include Group Members</Label>
									<p className="text-sm text-muted-foreground">
										Issue bills to regular group members
									</p>
								</div>
								<Switch
									id="sched-includeMembers"
									checked={groupBillOptions.includeMembers}
									onCheckedChange={(checked) =>
										setGroupBillOptions((prev) => ({ ...prev, includeMembers: checked }))
									}
								/>
							</div>
						</CardContent>
					</Card>
				)}

				{/* Bill Amount */}
				<Card className="mb-6">
					<CardHeader>
						<CardTitle>Bill Amount</CardTitle>
						<CardDescription>The amount to charge for each generated bill</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
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
							<p className="text-sm text-muted-foreground">
								This amount will be used for each generated bill. The template may also define a
								default amount.
							</p>
						</div>
					</CardContent>
				</Card>

				{/* Actions */}
				<div className="flex gap-3">
					<Button variant="confirm" type="submit" loading={createSchedule.isPending}>
						{createSchedule.isPending ? 'Creating Schedule...' : 'Create Schedule'}
					</Button>
					<Button variant="cancel" type="button" onClick={() => navigate('/admin/bills/schedules')}>
						Cancel
					</Button>
				</div>
			</form>
		</div>
	)
}

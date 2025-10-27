import { Calendar, Clock, FileText } from 'lucide-react'
import { useMemo, useState } from 'react'
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
import { useCreateSchedule, useTemplates } from '@/hooks/useBills'
import { formatScheduleFrequency } from '@/lib/bills-utils'
import { usePageTitle } from '@/hooks/usePageTitle'

import type { CreateScheduleInput, EntityType, ScheduleFrequency } from '@repo/bills'

export default function AdminBillsSchedulesNewPage() {
	usePageTitle('Admin - Create Bill Schedule')

	const navigate = useNavigate()
	const createSchedule = useCreateSchedule()
	const { data: templates, isLoading: isLoadingTemplates } = useTemplates()

	const [formData, setFormData] = useState<{
		templateId: string
		payerId: string
		payerType: EntityType
		frequency: ScheduleFrequency
		amount: string
		startDate: string
	}>({
		templateId: '',
		payerId: '',
		payerType: 'character',
		frequency: 'monthly',
		amount: '',
		startDate: '',
	})

	const [errors, setErrors] = useState<Record<string, string>>({})
	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

	// Calculate next generation time preview
	const nextGenerationTime = useMemo(() => {
		const baseDate = formData.startDate ? new Date(formData.startDate) : new Date()

		switch (formData.frequency) {
			case 'daily':
				return new Date(baseDate.getTime() + 24 * 60 * 60 * 1000)
			case 'weekly':
				return new Date(baseDate.getTime() + 7 * 24 * 60 * 60 * 1000)
			case 'monthly':
				const nextMonth = new Date(baseDate)
				nextMonth.setMonth(nextMonth.getMonth() + 1)
				return nextMonth
			default:
				return baseDate
		}
	}, [formData.frequency, formData.startDate])

	const handleChange = (field: string, value: string) => {
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

		if (!formData.templateId) {
			newErrors.templateId = 'Template is required'
		}

		if (!formData.payerId.trim()) {
			newErrors.payerId = 'Payer ID is required'
		}

		if (!formData.amount.trim()) {
			newErrors.amount = 'Amount is required'
		} else if (isNaN(Number(formData.amount)) || Number(formData.amount) <= 0) {
			newErrors.amount = 'Amount must be a positive number'
		}

		if (formData.startDate) {
			const startDate = new Date(formData.startDate)
			const now = new Date()
			now.setHours(0, 0, 0, 0)
			if (startDate < now) {
				newErrors.startDate = 'Start date cannot be in the past'
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
				frequency: formData.frequency,
				amount: formData.amount.trim(),
				startDate: formData.startDate ? new Date(formData.startDate) : undefined,
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
					<p className="text-muted-foreground mt-2">
						Set up automated recurring bill generation
					</p>
				</div>
				<Button variant="outline" asChild>
					<Link to="/admin/bills/schedules">
						<Calendar className="mr-2 h-4 w-4" />
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
				<Card variant="interactive" className="mb-6">
					<CardHeader>
						<CardTitle>Schedule Configuration</CardTitle>
						<CardDescription>
							Configure how and when bills should be generated
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="templateId">
								Bill Template <span className="text-destructive">*</span>
							</Label>
							<Select
								value={formData.templateId}
								onValueChange={(value) => handleChange('templateId', value)}
							>
								<SelectTrigger
									id="templateId"
									className={errors.templateId ? 'border-destructive' : ''}
								>
									<SelectValue placeholder="Select a template..." />
								</SelectTrigger>
								<SelectContent>
									{isLoadingTemplates ? (
										<SelectItem value="__loading__" disabled>
											Loading templates...
										</SelectItem>
									) : !templates || templates.length === 0 ? (
										<SelectItem value="__none__" disabled>
											No templates available
										</SelectItem>
									) : (
										templates.map((template) => (
											<SelectItem key={template.id} value={template.id}>
												{template.name}
											</SelectItem>
										))
									)}
								</SelectContent>
							</Select>
							{errors.templateId && (
								<p className="text-sm text-destructive">{errors.templateId}</p>
							)}
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
									value={formData.frequency}
									onValueChange={(value) => handleChange('frequency', value)}
								>
									<SelectTrigger id="frequency">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="daily">Daily</SelectItem>
										<SelectItem value="weekly">Weekly</SelectItem>
										<SelectItem value="monthly">Monthly</SelectItem>
									</SelectContent>
								</Select>
								<p className="text-sm text-muted-foreground">
									How often bills should be generated
								</p>
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
								{errors.startDate && (
									<p className="text-sm text-destructive">{errors.startDate}</p>
								)}
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
										})}
									</p>
									<p className="text-muted-foreground mt-1">
										Bills will be generated {formatScheduleFrequency(formData.frequency).toLowerCase()} starting from{' '}
										{formData.startDate ? 'the specified date' : 'now'}
									</p>
								</div>
							</div>
						</div>
					</CardContent>
				</Card>

				{/* Payer Information */}
				<Card variant="interactive" className="mb-6">
					<CardHeader>
						<CardTitle>Payer Information</CardTitle>
						<CardDescription>Who will receive these recurring bills?</CardDescription>
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

				{/* Bill Amount */}
				<Card variant="interactive" className="mb-6">
					<CardHeader>
						<CardTitle>Bill Amount</CardTitle>
						<CardDescription>
							The amount to charge for each generated bill
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
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
							<p className="text-sm text-muted-foreground">
								This amount will be used for each generated bill. The template may also
								define a default amount.
							</p>
						</div>
					</CardContent>
				</Card>

				{/* Actions */}
				<div className="flex gap-3">
					<Button type="submit" disabled={createSchedule.isPending}>
						{createSchedule.isPending ? 'Creating Schedule...' : 'Create Schedule'}
					</Button>
					<CancelButton
						type="button"
						onClick={() => navigate('/admin/bills/schedules')}
					>
						Cancel
					</CancelButton>
				</div>
			</form>
		</div>
	)
}

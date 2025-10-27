import { Calendar, Clock, Pause, Play, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CancelButton } from '@/components/ui/cancel-button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DestructiveButton } from '@/components/ui/destructive-button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingSpinner } from '@/components/ui/loading'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import {
	useDeleteSchedule,
	usePauseSchedule,
	useResumeSchedule,
	useSchedule,
	useScheduleExecutionLogs,
	useTemplates,
	useUpdateSchedule,
} from '@/hooks/useBills'
import { formatScheduleFrequency } from '@/lib/bills-utils'
import { usePageTitle } from '@/hooks/usePageTitle'

import type { EntityType, ScheduleFrequency, UpdateScheduleInput } from '@repo/bills'

export default function AdminBillsSchedulesEditPage() {
	const { id } = useParams<{ id: string }>()
	const navigate = useNavigate()

	const { data: schedule, isLoading: isLoadingSchedule } = useSchedule(id!)
	const { data: templates, isLoading: isLoadingTemplates } = useTemplates()
	const { data: executionLogs, isLoading: isLoadingLogs } = useScheduleExecutionLogs(id!, 10)
	const updateSchedule = useUpdateSchedule()
	const deleteSchedule = useDeleteSchedule()
	const pauseSchedule = usePauseSchedule()
	const resumeSchedule = useResumeSchedule()

	usePageTitle(schedule ? `Edit Schedule - ${schedule.templateId}` : 'Edit Schedule')

	const [formData, setFormData] = useState<{
		templateId: string
		frequency: ScheduleFrequency
		amount: string
	}>({
		templateId: '',
		frequency: 'monthly',
		amount: '',
	})

	const [errors, setErrors] = useState<Record<string, string>>({})
	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

	// Dialog states
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
	const [pauseDialogOpen, setPauseDialogOpen] = useState(false)
	const [resumeDialogOpen, setResumeDialogOpen] = useState(false)

	// Populate form when schedule loads
	useEffect(() => {
		if (schedule) {
			setFormData({
				templateId: schedule.templateId,
				frequency: schedule.frequency,
				amount: schedule.amount,
			})
		}
	}, [schedule])

	// Calculate next generation time preview
	const nextGenerationPreview = useMemo(() => {
		if (!schedule) return null
		return new Date(schedule.nextGenerationTime)
	}, [schedule])

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

		if (!formData.amount.trim()) {
			newErrors.amount = 'Amount is required'
		} else if (isNaN(Number(formData.amount)) || Number(formData.amount) <= 0) {
			newErrors.amount = 'Amount must be a positive number'
		}

		setErrors(newErrors)
		return Object.keys(newErrors).length === 0
	}

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()

		if (!validate() || !id) {
			return
		}

		try {
			const input: UpdateScheduleInput = {
				templateId: formData.templateId,
				frequency: formData.frequency,
				amount: formData.amount.trim(),
			}

			await updateSchedule.mutateAsync({ id, data: input })
			setMessage({ type: 'success', text: 'Schedule updated successfully!' })
		} catch (error) {
			console.error('Failed to update schedule:', error)
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to update schedule',
			})
		}
	}

	const handleDelete = async () => {
		if (!id) return

		try {
			await deleteSchedule.mutateAsync(id)
			setDeleteDialogOpen(false)
			navigate('/admin/bills/schedules')
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to delete schedule',
			})
			setDeleteDialogOpen(false)
		}
	}

	const handlePause = async () => {
		if (!id) return

		try {
			await pauseSchedule.mutateAsync(id)
			setPauseDialogOpen(false)
			setMessage({ type: 'success', text: 'Schedule paused successfully!' })
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to pause schedule',
			})
			setPauseDialogOpen(false)
		}
	}

	const handleResume = async () => {
		if (!id) return

		try {
			await resumeSchedule.mutateAsync(id)
			setResumeDialogOpen(false)
			setMessage({ type: 'success', text: 'Schedule resumed successfully!' })
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to resume schedule',
			})
			setResumeDialogOpen(false)
		}
	}

	if (isLoadingSchedule) {
		return (
			<div className="flex items-center justify-center min-h-[400px]">
				<LoadingSpinner label="Loading schedule..." />
			</div>
		)
	}

	if (!schedule) {
		return (
			<div className="space-y-6">
				<Card className="border-destructive bg-destructive/10">
					<CardContent className="py-6">
						<p className="text-destructive">Schedule not found</p>
					</CardContent>
				</Card>
				<Button variant="outline" asChild>
					<Link to="/admin/bills/schedules">Back to Schedules</Link>
				</Button>
			</div>
		)
	}

	const selectedTemplate = templates?.find((t) => t.id === formData.templateId)

	return (
		<div className="space-y-6">
			{/* Page Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-3xl font-bold gradient-text">Edit Bill Schedule</h1>
					<p className="text-muted-foreground mt-2">
						Manage recurring bill generation schedule
					</p>
				</div>
				<div className="flex gap-2">
					{schedule.isActive ? (
						<CancelButton
							size="sm"
							onClick={() => setPauseDialogOpen(true)}
							loading={pauseSchedule.isPending}
						>
							<Pause className="mr-2 h-4 w-4" />
							Pause Schedule
						</CancelButton>
					) : (
						<Button
							size="sm"
							variant="outline"
							onClick={() => setResumeDialogOpen(true)}
						>
							<Play className="mr-2 h-4 w-4" />
							Resume Schedule
						</Button>
					)}
					<DestructiveButton
						size="sm"
						onClick={() => setDeleteDialogOpen(true)}
						loading={deleteSchedule.isPending}
					>
						<Trash2 className="mr-2 h-4 w-4" />
						Delete
					</DestructiveButton>
					<Button variant="outline" asChild>
						<Link to="/admin/bills/schedules">
							<Calendar className="mr-2 h-4 w-4" />
							Back to Schedules
						</Link>
					</Button>
				</div>
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

			{/* Schedule Status */}
			<Card variant="interactive">
				<CardHeader>
					<CardTitle>Schedule Status</CardTitle>
					<CardDescription>Current schedule information and status</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						<div>
							<Label className="text-muted-foreground">Status</Label>
							<div className="mt-1">
								<Badge variant={schedule.isActive ? 'default' : 'secondary'}>
									{schedule.isActive ? 'Active' : 'Paused'}
								</Badge>
							</div>
						</div>
						<div>
							<Label className="text-muted-foreground">Consecutive Failures</Label>
							<div className="mt-1">
								<Badge
									variant={schedule.consecutiveFailures > 0 ? 'destructive' : 'default'}
								>
									{schedule.consecutiveFailures}
								</Badge>
							</div>
						</div>
					</div>

					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						<div>
							<Label className="text-muted-foreground">Next Generation Time</Label>
							<div className="mt-1 flex items-center gap-2">
								<Clock className="h-4 w-4 text-muted-foreground" />
								<span className="text-sm">
									{nextGenerationPreview
										? nextGenerationPreview.toLocaleString('en-US', {
												dateStyle: 'full',
												timeStyle: 'short',
											})
										: 'N/A'}
								</span>
							</div>
						</div>
						<div>
							<Label className="text-muted-foreground">Last Generation Time</Label>
							<div className="mt-1 flex items-center gap-2">
								<Clock className="h-4 w-4 text-muted-foreground" />
								<span className="text-sm">
									{schedule.lastGenerationTime
										? new Date(schedule.lastGenerationTime).toLocaleString()
										: 'Never'}
								</span>
							</div>
						</div>
					</div>

					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						<div>
							<Label className="text-muted-foreground">Payer</Label>
							<div className="mt-1 text-sm">
								{schedule.payerType}: {schedule.payerId}
							</div>
						</div>
						<div>
							<Label className="text-muted-foreground">Created</Label>
							<div className="mt-1 text-sm">
								{new Date(schedule.createdAt).toLocaleDateString()}
							</div>
						</div>
					</div>
				</CardContent>
			</Card>

			<form onSubmit={handleSubmit}>
				{/* Schedule Configuration */}
				<Card variant="interactive" className="mb-6">
					<CardHeader>
						<CardTitle>Schedule Configuration</CardTitle>
						<CardDescription>Modify schedule settings</CardDescription>
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
						</div>
					</CardContent>
				</Card>

				{/* Actions */}
				<div className="flex gap-3 mb-6">
					<Button type="submit" disabled={updateSchedule.isPending}>
						{updateSchedule.isPending ? 'Saving Changes...' : 'Save Changes'}
					</Button>
					<CancelButton
						type="button"
						onClick={() => navigate('/admin/bills/schedules')}
					>
						Cancel
					</CancelButton>
				</div>
			</form>

			{/* Execution Logs */}
			<Card variant="interactive">
				<CardHeader>
					<CardTitle>Execution History</CardTitle>
					<CardDescription>Recent schedule executions and generated bills</CardDescription>
				</CardHeader>
				<CardContent>
					{isLoadingLogs ? (
						<div className="flex justify-center py-8">
							<LoadingSpinner label="Loading execution logs..." />
						</div>
					) : !executionLogs || executionLogs.length === 0 ? (
						<div className="text-center py-8 text-muted-foreground">
							<p>No execution history yet</p>
							<p className="text-sm mt-1">
								Bills will appear here once the schedule starts generating them
							</p>
						</div>
					) : (
						<div className="overflow-x-auto">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Status</TableHead>
										<TableHead>Executed At</TableHead>
										<TableHead>Generated Bill</TableHead>
										<TableHead>Error</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{executionLogs.map((log) => (
										<TableRow key={log.id}>
											<TableCell>
												<Badge variant={log.success ? 'default' : 'destructive'}>
													{log.success ? 'Success' : 'Failed'}
												</Badge>
											</TableCell>
											<TableCell>
												<div className="text-sm">
													{new Date(log.executedAt).toLocaleString()}
												</div>
											</TableCell>
											<TableCell>
												{log.generatedBillId ? (
													<Link
														to={`/admin/bills/${log.generatedBillId}`}
														className="text-primary hover:underline text-sm"
													>
														{log.generatedBillId}
													</Link>
												) : (
													<span className="text-muted-foreground text-sm">N/A</span>
												)}
											</TableCell>
											<TableCell>
												{log.errorMessage ? (
													<span className="text-sm text-destructive">
														{log.errorMessage}
													</span>
												) : (
													<span className="text-muted-foreground text-sm">-</span>
												)}
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
					)}
				</CardContent>
			</Card>

			{/* Pause Dialog */}
			<Dialog open={pauseDialogOpen} onOpenChange={setPauseDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Pause Schedule</DialogTitle>
						<DialogDescription>
							Are you sure you want to pause this schedule? No new bills will be
							generated until you resume it.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<CancelButton onClick={() => setPauseDialogOpen(false)}>Cancel</CancelButton>
						<Button onClick={handlePause} disabled={pauseSchedule.isPending}>
							{pauseSchedule.isPending ? 'Pausing...' : 'Pause Schedule'}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Resume Dialog */}
			<Dialog open={resumeDialogOpen} onOpenChange={setResumeDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Resume Schedule</DialogTitle>
						<DialogDescription>
							Resume this schedule? Bills will start being generated again according to
							the configured frequency.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<CancelButton onClick={() => setResumeDialogOpen(false)}>Cancel</CancelButton>
						<Button onClick={handleResume} disabled={resumeSchedule.isPending}>
							{resumeSchedule.isPending ? 'Resuming...' : 'Resume Schedule'}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Delete Confirmation Dialog */}
			<Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete Schedule</DialogTitle>
						<DialogDescription>
							Are you sure you want to delete this schedule? This action cannot be undone.
							Existing bills will not be affected.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<CancelButton onClick={() => setDeleteDialogOpen(false)}>Cancel</CancelButton>
						<DestructiveButton onClick={handleDelete} loading={deleteSchedule.isPending}>
							Delete Schedule
						</DestructiveButton>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}

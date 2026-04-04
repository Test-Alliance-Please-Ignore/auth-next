import { Calendar, Clock, Pause, Play, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { BillEntityPicker } from '@/components/bills/bill-entity-picker'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { NumberInput } from '@/components/ui/number-input'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import {
	useBillEntitySearch,
	useDeleteSchedule,
	usePauseSchedule,
	useResumeSchedule,
	useSchedule,
	useScheduleExecutionLogs,
	useTemplates,
	useUpdateSchedule,
} from '@/hooks/useBills'
import { useDebounce } from '@/hooks/useDebounce'
import { usePageTitle } from '@/hooks/usePageTitle'
import { formatScheduleFrequency } from '@/lib/bills-utils'

import type { EntityType, PayeeType, ScheduleFrequency, UpdateScheduleInput } from '@repo/bills'
import { Button } from '@/components/ui/button'

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
		payerId: string
		payerType: EntityType
		payeeId: string
		payeeType: PayeeType
		frequency: ScheduleFrequency
		amount: string
	}>({
		templateId: '',
		payerId: '',
		payerType: 'character',
		payeeId: '',
		payeeType: 'character',
		frequency: 'monthly',
		amount: '',
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

	// Dialog states
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
	const [pauseDialogOpen, setPauseDialogOpen] = useState(false)
	const [resumeDialogOpen, setResumeDialogOpen] = useState(false)

	// Populate form when schedule loads
	useEffect(() => {
		if (schedule) {
			setFormData({
				templateId: schedule.templateId,
				payerId: schedule.payerId,
				payerType: schedule.payerType,
				payeeId: schedule.payeeId ?? '',
				payeeType: (schedule.payeeType ?? 'character') as PayeeType,
				frequency: schedule.frequency,
				amount: schedule.amount,
			})
			setGroupBillOptions({
				includeOwner: schedule.groupBillIncludeOwner,
				includeAdmins: schedule.groupBillIncludeAdmins,
				includeMembers: schedule.groupBillIncludeMembers,
			})
			setPayerQuery('')
			setPayeeQuery('')
			if (schedule.payerName) setPayerName(schedule.payerName)
			if (schedule.payeeName) setPayeeName(schedule.payeeName)
		}
	}, [schedule])

	// Calculate next generation time preview
	const nextGenerationPreview = useMemo(() => {
		if (!schedule) return null
		return new Date(schedule.nextGenerationTime)
	}, [schedule])

	const handleChange = (field: string, value: string) => {
		setFormData((prev) => ({ ...prev, [field]: value }))
		if (field === 'payerType') {
			setPayerQuery('')
			setFormData((prev) => ({ ...prev, payerId: '' }))
		}
		if (field === 'payeeType') {
			setPayeeQuery('')
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

		if (!formData.amount.trim()) {
			newErrors.amount = 'Amount is required'
		} else if (isNaN(Number(formData.amount)) || Number(formData.amount) <= 0) {
			newErrors.amount = 'Amount must be a positive number'
		}
		if (!formData.payerId.trim()) {
			newErrors.payerId = 'Payer is required'
		}
		if (!formData.payeeId.trim()) {
			newErrors.payeeId = 'Payee is required'
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

		if (!validate() || !id) {
			return
		}

		try {
			const input: UpdateScheduleInput = {
				templateId: formData.templateId,
				payerId: formData.payerId.trim(),
				payerType: formData.payerType,
				payeeId: formData.payeeId.trim(),
				payeeType: formData.payeeType,
				frequency: formData.frequency,
				amount: formData.amount.trim(),
				...(formData.payerType === 'group' && {
					groupBillIncludeOwner: groupBillOptions.includeOwner,
					groupBillIncludeAdmins: groupBillOptions.includeAdmins,
					groupBillIncludeMembers: groupBillOptions.includeMembers,
				}),
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
				<Button variant="ghost" asChild>
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
					<p className="text-muted-foreground mt-2">Manage recurring bill generation schedule</p>
				</div>
				<div className="flex gap-2">
					{schedule.isActive ? (
						<Button variant="cancel"
							size="sm"
							onClick={() => setPauseDialogOpen(true)}
							loading={pauseSchedule.isPending}
						>
							<Pause className="mr-2 h-4 w-4" />
							Pause Schedule
						</Button>
					) : (
						<Button variant="ghost" size="sm" onClick={() => setResumeDialogOpen(true)}>
							<Play className="mr-2 h-4 w-4" />
							Resume Schedule
						</Button>
					)}
					<Button variant="danger"
						size="sm"
						onClick={() => setDeleteDialogOpen(true)}
						loading={deleteSchedule.isPending}
					>
						<Trash2 className="mr-2 h-4 w-4" />
						Delete
					</Button>
					<Button variant="ghost" asChild>
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
								<Badge variant={schedule.consecutiveFailures > 0 ? 'destructive' : 'default'}>
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
							<Label className="text-muted-foreground">Payee</Label>
							<div className="mt-1 text-sm">
								{schedule.payeeType ?? 'character'}: {schedule.payeeId ?? '—'}
							</div>
						</div>
					</div>

					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
						</div>

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
							onEntitySelect={(entityId, name) => { handleChange('payerId', entityId); setPayerName(name) }}
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
							onEntitySelect={(entityId, name) => { handleChange('payeeId', entityId); setPayeeName(name) }}
							loading={payeeEntitySearch.isLoading}
							selectedEntityId={formData.payeeId}
							selectedEntityName={payeeName}
							error={errors.payeeId}
						/>

						{/* Group Bill Options */}
						{formData.payerType === 'group' && (
							<div className="space-y-3 pt-2">
								<div>
									<h3 className="text-sm font-medium">Group Bill Options</h3>
									<p className="text-sm text-muted-foreground">
										Select which member roles to issue individual bills to on each execution
									</p>
									{errors.groupBillOptions && (
										<p className="text-sm text-destructive mt-1">{errors.groupBillOptions}</p>
									)}
								</div>
								<div className="flex items-center justify-between">
									<Label htmlFor="edit-includeOwner">Include Group Owner</Label>
									<Switch
										id="edit-includeOwner"
										checked={groupBillOptions.includeOwner}
										onCheckedChange={(checked) =>
											setGroupBillOptions((prev) => ({ ...prev, includeOwner: checked }))
										}
									/>
								</div>
								<div className="flex items-center justify-between">
									<Label htmlFor="edit-includeAdmins">Include Group Admins</Label>
									<Switch
										id="edit-includeAdmins"
										checked={groupBillOptions.includeAdmins}
										onCheckedChange={(checked) =>
											setGroupBillOptions((prev) => ({ ...prev, includeAdmins: checked }))
										}
									/>
								</div>
								<div className="flex items-center justify-between">
									<Label htmlFor="edit-includeMembers">Include Group Members</Label>
									<Switch
										id="edit-includeMembers"
										checked={groupBillOptions.includeMembers}
										onCheckedChange={(checked) =>
											setGroupBillOptions((prev) => ({ ...prev, includeMembers: checked }))
										}
									/>
								</div>
							</div>
						)}
					</CardContent>
				</Card>

				{/* Actions */}
				<div className="flex gap-3 mb-6">
					<Button variant="confirm" type="submit" loading={updateSchedule.isPending}>
						{updateSchedule.isPending ? 'Saving Changes...' : 'Save Changes'}
					</Button>
					<Button variant="cancel" type="button" onClick={() => navigate('/admin/bills/schedules')}>
						Cancel
					</Button>
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
												<div className="text-sm">{new Date(log.executedAt).toLocaleString()}</div>
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
													<span className="text-sm text-destructive">{log.errorMessage}</span>
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
							Are you sure you want to pause this schedule? No new bills will be generated until you
							resume it.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="cancel" onClick={() => setPauseDialogOpen(false)}>Cancel</Button>
						<Button variant="confirm" onClick={handlePause} loading={pauseSchedule.isPending}>
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
							Resume this schedule? Bills will start being generated again according to the
							configured frequency.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="cancel" onClick={() => setResumeDialogOpen(false)}>Cancel</Button>
						<Button variant="confirm" onClick={handleResume} loading={resumeSchedule.isPending}>
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
							Are you sure you want to delete this schedule? This action cannot be undone. Existing
							bills will not be affected.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="cancel" onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
						<Button variant="danger" onClick={handleDelete} loading={deleteSchedule.isPending}>
							Delete Schedule
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}

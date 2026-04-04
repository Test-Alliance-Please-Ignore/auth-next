import { ArrowLeft, Calendar, Pause, Play, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
	useSchedules,
} from '@/hooks/useBills'
import { usePageTitle } from '@/hooks/usePageTitle'
import { formatScheduleFrequency } from '@/lib/bills-utils'
import { Button } from '@/components/ui/button'

export default function BillsSchedulesPage() {
	usePageTitle('Admin - Bill Schedules')

	const { data: schedules, isLoading, isError, error } = useSchedules()
	const pauseSchedule = usePauseSchedule()
	const resumeSchedule = useResumeSchedule()
	const deleteSchedule = useDeleteSchedule()

	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

	// Action handlers
	const handlePause = async (scheduleId: string) => {
		try {
			await pauseSchedule.mutateAsync(scheduleId)
			setMessage({ type: 'success', text: 'Schedule paused successfully!' })
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to pause schedule',
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const handleResume = async (scheduleId: string) => {
		try {
			await resumeSchedule.mutateAsync(scheduleId)
			setMessage({ type: 'success', text: 'Schedule resumed successfully!' })
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to resume schedule',
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const handleDelete = async (scheduleId: string) => {
		if (!confirm('Are you sure you want to delete this schedule? This action cannot be undone.'))
			return
		try {
			await deleteSchedule.mutateAsync(scheduleId)
			setMessage({ type: 'success', text: 'Schedule deleted successfully!' })
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to delete schedule',
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	return (
		<div className="space-y-6">
			{/* Page Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-3xl font-bold gradient-text">Bill Schedules</h1>
					<p className="text-muted-foreground mt-1">
						Manage recurring bill schedules and automation
					</p>
				</div>
				<div className="flex gap-2">
					<Button variant="ghost" asChild>
						<Link to="/admin/bills">
							<ArrowLeft className="mr-2 h-4 w-4" />
							Back to Bills
						</Link>
					</Button>
					<Button variant="primary" asChild>
						<Link to="/admin/bills/schedules/new">
							<Plus className="mr-2 h-4 w-4" />
							Create Schedule
						</Link>
					</Button>
				</div>
			</div>

			{/* Success/Error Message */}
			{message && (
				<Card className={message.type === 'error' ? 'border-destructive' : 'border-success'}>
					<CardContent className="pt-6">
						<p className={message.type === 'error' ? 'text-destructive' : 'text-success'}>
							{message.text}
						</p>
					</CardContent>
				</Card>
			)}

			{/* Schedules Table */}
			<Card>
				<CardHeader>
					<CardTitle>All Schedules</CardTitle>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<div className="flex justify-center py-12">
							<div className="text-muted-foreground">Loading schedules...</div>
						</div>
					) : isError ? (
						<div className="text-center py-12">
							<h3 className="text-lg font-semibold mb-2">Failed to load schedules</h3>
							<p className="text-muted-foreground mb-4">
								{error instanceof Error ? error.message : 'Unexpected error'}
							</p>
						</div>
					) : !schedules || schedules.length === 0 ? (
						<div className="text-center py-12">
							<Calendar className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
							<h3 className="text-lg font-semibold mb-2">No schedules found</h3>
							<p className="text-muted-foreground mb-4">
								Create your first schedule to automate recurring bills
							</p>
							<Button variant="primary" asChild>
								<Link to="/admin/bills/schedules/new">
									<Plus className="mr-2 h-4 w-4" />
									Create Schedule
								</Link>
							</Button>
						</div>
					) : (
						<div className="overflow-x-auto">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Status</TableHead>
										<TableHead>Template</TableHead>
										<TableHead>Payer</TableHead>
										<TableHead>Payee</TableHead>
										<TableHead>Frequency</TableHead>
										<TableHead>Next Run</TableHead>
										<TableHead>Failures</TableHead>
										<TableHead className="sticky right-0 z-20 bg-card text-center">
											Actions
										</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{schedules.map((schedule) => (
										<TableRow key={schedule.id}>
											<TableCell>
												<Badge variant={schedule.isActive ? 'default' : 'secondary'}>
													{schedule.isActive ? 'Active' : 'Paused'}
												</Badge>
											</TableCell>
											<TableCell>
												<div className="font-medium">
													{schedule.template?.name ?? schedule.templateId}
												</div>
												<div className="text-xs text-muted-foreground">{schedule.templateId}</div>
											</TableCell>
											<TableCell>
												<div className="text-sm">{schedule.payerName ?? schedule.payerId}</div>
												<div className="text-xs text-muted-foreground">
													{schedule.payerType}: {schedule.payerId}
												</div>
											</TableCell>
											<TableCell>
												<div className="text-sm">
													{schedule.payeeName ?? schedule.payeeId ?? '—'}
												</div>
												<div className="text-xs text-muted-foreground">
													{schedule.payeeType ?? 'character'}: {schedule.payeeId ?? '—'}
												</div>
											</TableCell>
											<TableCell>{formatScheduleFrequency(schedule.frequency)}</TableCell>
											<TableCell>
												<div className="text-sm">
													{new Date(schedule.nextGenerationTime).toLocaleString()}
												</div>
											</TableCell>
											<TableCell>
												<Badge
													variant={schedule.consecutiveFailures > 0 ? 'destructive' : 'default'}
												>
													{schedule.consecutiveFailures}
												</Badge>
											</TableCell>
											<TableCell className="sticky right-0 z-10 bg-card text-right">
												<div className="flex justify-end gap-2">
													{schedule.isActive ? (
														<Button variant="cancel"
															size="sm"
															showIcon={false}
															onClick={() => handlePause(schedule.id)}
															loading={pauseSchedule.isPending}
														>
															<Pause className="h-4 w-4 mr-2" />
															Pause
														</Button>
													) : (
														<Button variant="confirm"
															size="sm"
															showIcon={false}
															onClick={() => handleResume(schedule.id)}
															loading={resumeSchedule.isPending}
														>
															<Play className="h-4 w-4 mr-2" />
															Resume
														</Button>
													)}
													<Button variant="danger"
														size="sm"
														showIcon={false}
														onClick={() => handleDelete(schedule.id)}
														loading={deleteSchedule.isPending}
													>
														Delete
													</Button>
													<Button variant="primary" size="sm" asChild>
														<Link to={`/admin/bills/schedules/${schedule.id}`}>View</Link>
													</Button>
												</div>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	)
}

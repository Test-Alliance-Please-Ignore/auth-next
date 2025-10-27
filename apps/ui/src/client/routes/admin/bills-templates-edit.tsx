import { Copy, FileText, Info, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

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
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
	useCloneTemplate,
	useDeleteTemplate,
	useTemplate,
	useUpdateTemplate,
} from '@/hooks/useBills'
import { usePageTitle } from '@/hooks/usePageTitle'

import type { LateFeeCompounding, LateFeeType, UpdateTemplateInput } from '@repo/bills'

export default function AdminBillsTemplatesEditPage() {
	const { id } = useParams<{ id: string }>()
	const navigate = useNavigate()

	const { data: template, isLoading: isLoadingTemplate } = useTemplate(id!)
	const updateTemplate = useUpdateTemplate()
	const deleteTemplate = useDeleteTemplate()
	const cloneTemplate = useCloneTemplate()

	usePageTitle(template ? `Edit Template - ${template.name}` : 'Edit Template')

	const [formData, setFormData] = useState<{
		name: string
		description: string
		titleTemplate: string
		descriptionTemplate: string
		amountTemplate: string
		daysUntilDue: string
		enableLateFee: boolean
		lateFeeType: LateFeeType
		lateFeeAmount: string
		lateFeeCompounding: LateFeeCompounding
	}>({
		name: '',
		description: '',
		titleTemplate: '',
		descriptionTemplate: '',
		amountTemplate: '',
		daysUntilDue: '30',
		enableLateFee: false,
		lateFeeType: 'static',
		lateFeeAmount: '',
		lateFeeCompounding: 'none',
	})

	const [errors, setErrors] = useState<Record<string, string>>({})
	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

	// Dialog states
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
	const [cloneDialogOpen, setCloneDialogOpen] = useState(false)
	const [cloneName, setCloneName] = useState('')

	// Populate form when template loads
	useEffect(() => {
		if (template) {
			setFormData({
				name: template.name,
				description: template.description || '',
				titleTemplate: template.titleTemplate,
				descriptionTemplate: template.descriptionTemplate || '',
				amountTemplate: template.amountTemplate || '',
				daysUntilDue: template.daysUntilDue ? String(template.daysUntilDue) : '',
				enableLateFee: template.lateFeeType && template.lateFeeType !== 'none',
				lateFeeType: template.lateFeeType || 'static',
				lateFeeAmount: template.lateFeeAmount || '',
				lateFeeCompounding: template.lateFeeCompounding || 'none',
			})
		}
	}, [template])

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

		if (!formData.name.trim()) {
			newErrors.name = 'Template name is required'
		}

		if (!formData.titleTemplate.trim()) {
			newErrors.titleTemplate = 'Title template is required'
		}

		if (formData.daysUntilDue && (isNaN(Number(formData.daysUntilDue)) || Number(formData.daysUntilDue) < 0)) {
			newErrors.daysUntilDue = 'Days until due must be a non-negative number'
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

		if (!validate() || !id) {
			return
		}

		try {
			const input: UpdateTemplateInput = {
				name: formData.name.trim(),
				description: formData.description.trim() || undefined,
				titleTemplate: formData.titleTemplate.trim(),
				descriptionTemplate: formData.descriptionTemplate.trim() || undefined,
				amountTemplate: formData.amountTemplate.trim() || undefined,
				daysUntilDue: formData.daysUntilDue ? Number(formData.daysUntilDue) : undefined,
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

			await updateTemplate.mutateAsync({ id, data: input })
			setMessage({ type: 'success', text: 'Template updated successfully!' })
		} catch (error) {
			console.error('Failed to update template:', error)
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to update template',
			})
		}
	}

	const handleDelete = async () => {
		if (!id) return

		try {
			await deleteTemplate.mutateAsync(id)
			setDeleteDialogOpen(false)
			navigate('/admin/bills/templates')
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to delete template',
			})
			setDeleteDialogOpen(false)
		}
	}

	const handleClone = async () => {
		if (!id || !cloneName.trim()) return

		try {
			await cloneTemplate.mutateAsync({
				sourceTemplateId: id,
				name: cloneName.trim(),
				description: `Cloned from ${template?.name}`,
			})
			setCloneDialogOpen(false)
			setCloneName('')
			setMessage({ type: 'success', text: 'Template cloned successfully!' })
			setTimeout(() => {
				navigate('/admin/bills/templates')
			}, 1500)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to clone template',
			})
			setCloneDialogOpen(false)
		}
	}

	if (isLoadingTemplate) {
		return (
			<div className="flex items-center justify-center min-h-[400px]">
				<LoadingSpinner label="Loading template..." />
			</div>
		)
	}

	if (!template) {
		return (
			<div className="space-y-6">
				<Card className="border-destructive bg-destructive/10">
					<CardContent className="py-6">
						<p className="text-destructive">Template not found</p>
					</CardContent>
				</Card>
				<Button variant="outline" asChild>
					<Link to="/admin/bills/templates">Back to Templates</Link>
				</Button>
			</div>
		)
	}

	return (
		<div className="space-y-6">
			{/* Page Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-3xl font-bold gradient-text">Edit Bill Template</h1>
					<p className="text-muted-foreground mt-2">Modify template: {template.name}</p>
				</div>
				<div className="flex gap-2">
					<Button
						variant="outline"
						size="sm"
						onClick={() => {
							setCloneName(`${template.name} (Copy)`)
							setCloneDialogOpen(true)
						}}
					>
						<Copy className="mr-2 h-4 w-4" />
						Clone
					</Button>
					<DestructiveButton
						size="sm"
						onClick={() => setDeleteDialogOpen(true)}
						loading={deleteTemplate.isPending}
					>
						<Trash2 className="mr-2 h-4 w-4" />
						Delete
					</DestructiveButton>
					<Button variant="outline" asChild>
						<Link to="/admin/bills/templates">
							<FileText className="mr-2 h-4 w-4" />
							Back to Templates
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

			<form onSubmit={handleSubmit}>
				{/* Template Information */}
				<Card variant="interactive" className="mb-6">
					<CardHeader>
						<CardTitle>Template Information</CardTitle>
						<CardDescription>Basic information about this template</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="name">
								Template Name <span className="text-destructive">*</span>
							</Label>
							<Input
								id="name"
								placeholder="e.g., Monthly Alliance Dues"
								value={formData.name}
								onChange={(e) => handleChange('name', e.target.value)}
								className={errors.name ? 'border-destructive' : ''}
							/>
							{errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
						</div>

						<div className="space-y-2">
							<Label htmlFor="description">Description</Label>
							<Textarea
								id="description"
								placeholder="Optional description of what this template is used for..."
								rows={2}
								value={formData.description}
								onChange={(e) => handleChange('description', e.target.value)}
							/>
							<p className="text-sm text-muted-foreground">
								Helps identify the purpose of this template
							</p>
						</div>
					</CardContent>
				</Card>

				{/* Template Content */}
				<Card variant="interactive" className="mb-6">
					<CardHeader>
						<CardTitle>Template Content</CardTitle>
						<CardDescription>
							Define the bill structure using placeholders
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="rounded-md bg-muted/50 p-4 border border-border">
							<div className="flex items-start gap-2">
								<Info className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
								<div className="text-sm text-muted-foreground">
									<p className="font-medium mb-1">Available Placeholders:</p>
									<code className="text-xs bg-background px-1 py-0.5 rounded">
										{'{amount}'}
									</code>
									{' - Bill amount, '}
									<code className="text-xs bg-background px-1 py-0.5 rounded">
										{'{payerName}'}
									</code>
									{' - Payer name, '}
									<code className="text-xs bg-background px-1 py-0.5 rounded">
										{'{payerType}'}
									</code>
									{' - Payer type, '}
									<code className="text-xs bg-background px-1 py-0.5 rounded">
										{'{dueDate}'}
									</code>
									{' - Due date'}
								</div>
							</div>
						</div>

						<div className="space-y-2">
							<Label htmlFor="titleTemplate">
								Title Template <span className="text-destructive">*</span>
							</Label>
							<Input
								id="titleTemplate"
								placeholder="e.g., Monthly Dues - {payerName}"
								value={formData.titleTemplate}
								onChange={(e) => handleChange('titleTemplate', e.target.value)}
								className={errors.titleTemplate ? 'border-destructive' : ''}
							/>
							{errors.titleTemplate && (
								<p className="text-sm text-destructive">{errors.titleTemplate}</p>
							)}
							<p className="text-sm text-muted-foreground">
								The title that will appear on generated bills
							</p>
						</div>

						<div className="space-y-2">
							<Label htmlFor="descriptionTemplate">Description Template</Label>
							<Textarea
								id="descriptionTemplate"
								placeholder="e.g., Monthly alliance dues for {payerName}. Amount: {amount} ISK"
								rows={3}
								value={formData.descriptionTemplate}
								onChange={(e) => handleChange('descriptionTemplate', e.target.value)}
							/>
							<p className="text-sm text-muted-foreground">
								Optional description with placeholders
							</p>
						</div>

						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							<div className="space-y-2">
								<Label htmlFor="amountTemplate">Amount Template</Label>
								<Input
									id="amountTemplate"
									placeholder="e.g., {amount} or 1000000"
									value={formData.amountTemplate}
									onChange={(e) => handleChange('amountTemplate', e.target.value)}
								/>
								<p className="text-sm text-muted-foreground">
									Fixed amount or placeholder for dynamic amounts
								</p>
							</div>

							<div className="space-y-2">
								<Label htmlFor="daysUntilDue">Days Until Due</Label>
								<Input
									id="daysUntilDue"
									type="number"
									min="0"
									placeholder="30"
									value={formData.daysUntilDue}
									onChange={(e) => handleChange('daysUntilDue', e.target.value)}
									className={errors.daysUntilDue ? 'border-destructive' : ''}
								/>
								{errors.daysUntilDue && (
									<p className="text-sm text-destructive">{errors.daysUntilDue}</p>
								)}
								<p className="text-sm text-muted-foreground">
									Number of days after bill creation until it's due
								</p>
							</div>
						</div>
					</CardContent>
				</Card>

				{/* Late Fee Settings */}
				<Card variant="interactive" className="mb-6">
					<CardHeader>
						<CardTitle>Late Fee Settings</CardTitle>
						<CardDescription>
							Configure default penalties for late payment
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="flex items-center justify-between">
							<div className="space-y-0.5">
								<Label htmlFor="enableLateFee">Enable Late Fees</Label>
								<p className="text-sm text-muted-foreground">
									Charge additional fees for late payment by default
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
									<Label htmlFor="lateFeeCompounding">Late Fee Compounding</Label>
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
											<SelectItem value="none">None (One-time fee)</SelectItem>
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
					<Button type="submit" disabled={updateTemplate.isPending}>
						{updateTemplate.isPending ? 'Saving Changes...' : 'Save Changes'}
					</Button>
					<CancelButton type="button" onClick={() => navigate('/admin/bills/templates')}>
						Cancel
					</CancelButton>
				</div>
			</form>

			{/* Clone Dialog */}
			<Dialog open={cloneDialogOpen} onOpenChange={setCloneDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Clone Template</DialogTitle>
						<DialogDescription>
							Create a copy of this template with a new name
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-4 py-4">
						<div className="space-y-2">
							<Label htmlFor="cloneName">New Template Name</Label>
							<Input
								id="cloneName"
								value={cloneName}
								onChange={(e) => setCloneName(e.target.value)}
								placeholder="Enter name for cloned template"
							/>
						</div>
					</div>
					<DialogFooter>
						<CancelButton onClick={() => setCloneDialogOpen(false)}>Cancel</CancelButton>
						<Button
							onClick={handleClone}
							disabled={!cloneName.trim() || cloneTemplate.isPending}
						>
							{cloneTemplate.isPending ? 'Cloning...' : 'Clone Template'}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Delete Confirmation Dialog */}
			<Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete Template</DialogTitle>
						<DialogDescription>
							Are you sure you want to delete "{template.name}"? This action cannot be
							undone.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<CancelButton onClick={() => setDeleteDialogOpen(false)}>Cancel</CancelButton>
						<DestructiveButton onClick={handleDelete} loading={deleteTemplate.isPending}>
							Delete Template
						</DestructiveButton>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}

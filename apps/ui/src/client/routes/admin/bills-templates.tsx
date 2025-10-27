import { Copy, FileText, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DestructiveButton } from '@/components/ui/destructive-button'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { useCloneTemplate, useDeleteTemplate, useTemplates } from '@/hooks/useBills'
import { formatLateFeeCompounding, formatLateFeeType } from '@/lib/bills-utils'
import { usePageTitle } from '@/hooks/usePageTitle'

export default function BillsTemplatesPage() {
	usePageTitle('Admin - Bill Templates')

	const { data: templates, isLoading } = useTemplates()
	const deleteTemplate = useDeleteTemplate()
	const cloneTemplate = useCloneTemplate()

	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

	// Action handlers
	const handleDelete = async (templateId: string, templateName: string) => {
		if (
			!confirm(
				`Are you sure you want to delete the template "${templateName}"? This action cannot be undone.`
			)
		)
			return
		try {
			await deleteTemplate.mutateAsync(templateId)
			setMessage({ type: 'success', text: 'Template deleted successfully!' })
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to delete template',
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const handleClone = async (templateId: string, templateName: string) => {
		const newName = prompt(`Enter a name for the cloned template:`, `${templateName} (Copy)`)
		if (!newName) return

		try {
			await cloneTemplate.mutateAsync({
				sourceTemplateId: templateId,
				name: newName,
				description: `Cloned from ${templateName}`,
			})
			setMessage({ type: 'success', text: 'Template cloned successfully!' })
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to clone template',
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	return (
		<div className="space-y-6">
			{/* Page Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-3xl font-bold gradient-text">Bill Templates</h1>
					<p className="text-muted-foreground mt-1">
						Manage reusable bill templates for quick bill creation
					</p>
				</div>
				<div className="flex gap-2">
					<Button variant="outline" asChild>
						<Link to="/admin/bills">
							<FileText className="mr-2 h-4 w-4" />
							Back to Bills
						</Link>
					</Button>
					<Button asChild>
						<Link to="/admin/bills/templates/new">
							<Plus className="mr-2 h-4 w-4" />
							Create Template
						</Link>
					</Button>
				</div>
			</div>

			{/* Success/Error Message */}
			{message && (
				<Card className={message.type === 'error' ? 'border-destructive' : 'border-success'}>
					<CardContent className="pt-6">
						<p
							className={
								message.type === 'error' ? 'text-destructive' : 'text-success'
							}
						>
							{message.text}
						</p>
					</CardContent>
				</Card>
			)}

			{/* Templates Table */}
			<Card>
				<CardHeader>
					<CardTitle>All Templates</CardTitle>
					<CardDescription>
						{templates ? `${templates.length} template(s) found` : 'Loading...'}
					</CardDescription>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<div className="flex justify-center py-12">
							<div className="text-muted-foreground">Loading templates...</div>
						</div>
					) : !templates || templates.length === 0 ? (
						<div className="text-center py-12">
							<FileText className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
							<h3 className="text-lg font-semibold mb-2">No templates found</h3>
							<p className="text-muted-foreground mb-4">
								Create your first template to streamline bill creation
							</p>
							<Button asChild>
								<Link to="/admin/bills/templates/new">
									<Plus className="mr-2 h-4 w-4" />
									Create Template
								</Link>
							</Button>
						</div>
					) : (
						<div className="overflow-x-auto">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Name</TableHead>
										<TableHead>Title Template</TableHead>
										<TableHead>Days Until Due</TableHead>
										<TableHead>Late Fee</TableHead>
										<TableHead>Created</TableHead>
										<TableHead className="text-right">Actions</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{templates.map((template) => (
										<TableRow key={template.id}>
											<TableCell>
												<div>
													<div className="font-medium">{template.name}</div>
													{template.description && (
														<div className="text-sm text-muted-foreground">
															{template.description}
														</div>
													)}
												</div>
											</TableCell>
											<TableCell>
												<code className="text-sm bg-muted px-2 py-1 rounded">
													{template.titleTemplate}
												</code>
											</TableCell>
											<TableCell>
												{template.daysUntilDue ? `${template.daysUntilDue} days` : 'N/A'}
											</TableCell>
											<TableCell>
												<div className="text-sm">
													<div>{formatLateFeeType(template.lateFeeType)}</div>
													{template.lateFeeType && (
														<div className="text-muted-foreground">
															{template.lateFeeAmount}{' '}
															{template.lateFeeType === 'percentage' ? '%' : 'ISK'}
															{' · '}
															{formatLateFeeCompounding(template.lateFeeCompounding)}
														</div>
													)}
												</div>
											</TableCell>
											<TableCell>
												<div className="text-sm">
													{new Date(template.createdAt).toLocaleDateString()}
												</div>
											</TableCell>
											<TableCell className="text-right">
												<div className="flex justify-end gap-2">
													<Button
														size="sm"
														variant="outline"
														onClick={() => handleClone(template.id, template.name)}
														disabled={cloneTemplate.isPending}
													>
														<Copy className="h-4 w-4" />
													</Button>
													<DestructiveButton
														size="sm"
														showIcon={false}
														onClick={() => handleDelete(template.id, template.name)}
														loading={deleteTemplate.isPending}
													>
														<Trash2 className="h-4 w-4 mr-0" />
													</DestructiveButton>
													<Button size="sm" variant="outline" asChild>
														<Link to={`/admin/bills/templates/${template.id}`}>
															Edit
														</Link>
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

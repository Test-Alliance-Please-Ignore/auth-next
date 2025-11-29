/**
 * Template Selector Component
 *
 * A Select dropdown that allows HR staff to choose a message template
 * and insert its content into the message textarea.
 */

import { FileText, Settings } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { LoadingSpinner } from '@/components/ui/loading'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

import { useTemplates } from '../hooks'

import { ManageTemplatesDialog } from './manage-templates-dialog'

import type { MessageTemplate } from '../api'

// ============================================================================
// Types
// ============================================================================

export interface TemplateSelectorProps {
	corporationId: string
	onSelectTemplate: (template: MessageTemplate) => void
	className?: string
}

// ============================================================================
// Component
// ============================================================================

/**
 * Template selector dropdown with manage templates option
 */
export function TemplateSelector({
	corporationId,
	onSelectTemplate,
	className,
}: TemplateSelectorProps) {
	const [showManageDialog, setShowManageDialog] = useState(false)
	const [selectedValue, setSelectedValue] = useState<string>('')

	// Fetch templates (only active ones)
	const { data: templates, isLoading, error } = useTemplates(corporationId, 'active')

	const handleValueChange = (value: string) => {
		if (value === '__manage__') {
			setShowManageDialog(true)
			setSelectedValue('')
			return
		}

		const template = templates?.find((t) => t.id === value)
		if (template) {
			onSelectTemplate(template)
			setSelectedValue('')
		}
	}

	// Loading state
	if (isLoading) {
		return (
			<div className={cn('flex items-center gap-2 text-xs text-muted-foreground', className)}>
				<LoadingSpinner size="sm" />
				<span>Loading templates...</span>
			</div>
		)
	}

	// Error state - just hide the selector
	if (error) {
		return null
	}

	return (
		<>
			<div className={cn('flex items-center gap-2', className)}>
				<Select value={selectedValue} onValueChange={handleValueChange}>
					<SelectTrigger className="w-[200px] h-8 text-xs">
						<FileText className="h-3 w-3 mr-1.5 text-muted-foreground" />
						<SelectValue placeholder="Use template..." />
					</SelectTrigger>
					<SelectContent>
						{templates && templates.length > 0 ? (
							<>
								{templates.map((template) => (
									<SelectItem key={template.id} value={template.id} className="text-xs">
										<div className="flex flex-col">
											<span className="font-medium">{template.templateName}</span>
											{template.description && (
												<span className="text-muted-foreground text-xs truncate max-w-[180px]">
													{template.description}
												</span>
											)}
										</div>
									</SelectItem>
								))}
								<div className="border-t my-1" />
							</>
						) : (
							<div className="px-2 py-1.5 text-xs text-muted-foreground">
								No templates available
							</div>
						)}
						<SelectItem value="__manage__" className="text-xs">
							<div className="flex items-center gap-1.5">
								<Settings className="h-3 w-3" />
								<span>Manage templates...</span>
							</div>
						</SelectItem>
					</SelectContent>
				</Select>

				<Button
					variant="ghost"
					size="sm"
					className="h-8 px-2"
					onClick={() => setShowManageDialog(true)}
					title="Manage templates"
				>
					<Settings className="h-4 w-4" />
				</Button>
			</div>

			{/* Manage Templates Dialog */}
			<ManageTemplatesDialog
				open={showManageDialog}
				onOpenChange={setShowManageDialog}
				corporationId={corporationId}
			/>
		</>
	)
}

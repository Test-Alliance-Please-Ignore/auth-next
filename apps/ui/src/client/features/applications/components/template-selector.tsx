/**
 * Template Selector Component
 *
 * A Select dropdown that allows HR staff to choose a message template
 * and insert its content into the message textarea.
 */

import { Settings } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { LoadingSpinner } from '@/components/ui/loading'
import { Select } from '@/components/ui/select'
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
				<div className="h-8 w-[320px]">
					<Select
						value={selectedValue}
						onValueChange={handleValueChange}
						options={
							templates?.map((template) => ({ value: template.id,
								label: template.templateName,
								description: template.description ?? undefined,
							})) ?? []
						}
						placeholder="Use template..."
						className="text-xs"
						inputClassName="h-8 text-xs"
						contentClassName="w-[min(90vw,26rem)] text-xs"
						listMaxHeight="40rem"
						emptyText="No templates available"
					/>
				</div>

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

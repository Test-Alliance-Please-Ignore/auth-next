/**
 * InventoryParser Component
 *
 * Reusable component for parsing EVE Online inventory exports.
 * Can be used standalone or embedded in other features.
 */

import { useState } from 'react'

import { useParseInventory } from '../hooks/useInventoryParser'
import { useAppTranslation } from '../i18n'
import { JsonViewer } from './json-viewer'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Label } from './ui/label'
import { Textarea } from './ui/textarea'

import type { InventoryParseResult } from '@repo/eve-types'

export interface InventoryParserProps {
	/** Callback when parsing completes successfully */
	onParseComplete?: (result: InventoryParseResult) => void
	/** Show the output in JsonViewer (default: true) */
	showOutput?: boolean
	/** Initial inventory text value */
	initialValue?: string
	/** Number of rows for the textarea (default: 20) */
	rows?: number
	/** Custom class name for the container */
	className?: string
}

export function InventoryParser({
	onParseComplete,
	showOutput = true,
	initialValue = '',
	rows = 20,
	className = '',
}: InventoryParserProps) {
	const { t } = useAppTranslation()
	const [inventoryText, setInventoryText] = useState(initialValue)
	const [lastResult, setLastResult] = useState<InventoryParseResult | null>(null)

	const parseInventoryMutation = useParseInventory()

	const handleParse = async () => {
		if (!inventoryText.trim()) {
			return
		}

		try {
			const result = await parseInventoryMutation.mutateAsync(inventoryText)
			setLastResult(result)

			// Call the onParseComplete callback if provided
			if (onParseComplete) {
				onParseComplete(result)
			}
		} catch (error) {
			console.error('Failed to parse inventory:', error)
			setLastResult(null)
		}
	}

	const hasError = parseInventoryMutation.isError
	const isLoading = parseInventoryMutation.isPending

	return (
		<div className={`space-y-6 ${className}`}>
			{/* Input Section */}
			<Card>
				<CardHeader>
					<CardTitle>{t('inventoryParser.inputTitle')}</CardTitle>
					<CardDescription>{t('inventoryParser.inputDescription')}</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="inventory-input">{t('inventoryParser.inventoryText')}</Label>
						<Textarea
							id="inventory-input"
							value={inventoryText}
							onChange={(e) => setInventoryText(e.target.value)}
							rows={rows}
							className="font-mono text-sm"
						/>
					</div>

					<div className="flex items-center gap-4">
						<Button
							variant="confirm"
							onClick={handleParse}
							disabled={!inventoryText.trim() || isLoading}
							loading={isLoading}
						>
							{t('inventoryParser.parse')}
						</Button>

						{hasError && (
							<p className="text-sm text-destructive">{t('inventoryParser.parseError')}</p>
						)}
					</div>
				</CardContent>
			</Card>

			{/* Output Section (shown if showOutput is true and we have results) */}
			{showOutput && lastResult && (
				<Card>
					<CardHeader>
						<CardTitle>{t('inventoryParser.results')}</CardTitle>
						<CardDescription>
							{t('inventoryParser.parsed', { count: lastResult.summary.successCount })},{' '}
							{t('inventoryParser.error', { count: lastResult.summary.errorCount })}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<JsonViewer data={lastResult} />
					</CardContent>
				</Card>
			)}
		</div>
	)
}

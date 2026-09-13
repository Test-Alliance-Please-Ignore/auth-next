import { ChevronDown, ChevronRight, Copy } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { useMessage } from '@/hooks/useMessage'
import { formatNumber, useAppTranslation } from '@/i18n'

interface JsonViewerProps {
	data: unknown
	defaultExpanded?: boolean
	maxHeight?: string
}

export function JsonViewer({
	data,
	defaultExpanded = false,
	maxHeight = '400px',
}: JsonViewerProps) {
	const { t } = useAppTranslation()
	const { message, showSuccess, showError } = useMessage()

	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(JSON.stringify(data, null, 2))
			showSuccess((t) => t('common.jsonViewer.copied'), 2000)
		} catch {
			showError((t) => t('common.jsonViewer.copyFailed'))
		}
	}

	if (data === null || data === undefined) {
		return (
			<div className="text-sm text-muted-foreground italic p-2 border border-border rounded-md bg-muted/30">
				{t('common.jsonViewer.empty')}
			</div>
		)
	}

	return (
		<div className="relative border border-border rounded-md bg-muted/30">
			<div className="absolute top-2 right-2 z-10">
				<Button variant="ghost" size="sm" onClick={handleCopy}>
					<Copy className="h-3 w-3 mr-1" />
					{message?.type === 'success' ? message.text : t('common.jsonViewer.copy')}
				</Button>
			</div>
			{message?.type === 'error' && (
				<p role="alert" className="p-3 pr-24 text-sm text-destructive">
					{message.text}
				</p>
			)}
			<div className="p-3 overflow-auto" style={{ maxHeight }}>
				<JsonNode data={data} level={0} defaultExpanded={defaultExpanded} />
			</div>
		</div>
	)
}

interface JsonNodeProps {
	data: unknown
	level: number
	defaultExpanded?: boolean
	propertyName?: string
}

function JsonNode({ data, level, defaultExpanded = false, propertyName }: JsonNodeProps) {
	const { t } = useAppTranslation()
	const [isExpanded, setIsExpanded] = useState(defaultExpanded)
	const toggleLabel = t(isExpanded ? 'common.jsonViewer.collapse' : 'common.jsonViewer.expand', {
		name: propertyName ?? t('common.jsonViewer.root'),
	})

	const indent = level * 16

	if (data === null) {
		return (
			<div style={{ paddingLeft: `${indent}px` }} className="text-sm">
				{propertyName && <span className="text-primary font-medium">{propertyName}: </span>}
				<span className="text-muted-foreground">null</span>
			</div>
		)
	}

	if (data === undefined) {
		return (
			<div style={{ paddingLeft: `${indent}px` }} className="text-sm">
				{propertyName && <span className="text-primary font-medium">{propertyName}: </span>}
				<span className="text-muted-foreground">undefined</span>
			</div>
		)
	}

	if (typeof data === 'boolean') {
		return (
			<div style={{ paddingLeft: `${indent}px` }} className="text-sm">
				{propertyName && <span className="text-primary font-medium">{propertyName}: </span>}
				<span className="text-orange-500">{String(data)}</span>
			</div>
		)
	}

	if (typeof data === 'number') {
		return (
			<div style={{ paddingLeft: `${indent}px` }} className="text-sm">
				{propertyName && <span className="text-primary font-medium">{propertyName}: </span>}
				<span className="text-blue-500">{data}</span>
			</div>
		)
	}

	if (typeof data === 'string') {
		return (
			<div style={{ paddingLeft: `${indent}px` }} className="text-sm">
				{propertyName && <span className="text-primary font-medium">{propertyName}: </span>}
				<span className="text-green-600 dark:text-green-400">"{data}"</span>
			</div>
		)
	}

	if (Array.isArray(data)) {
		if (data.length === 0) {
			return (
				<div style={{ paddingLeft: `${indent}px` }} className="text-sm">
					{propertyName && <span className="text-primary font-medium">{propertyName}: </span>}
					<span className="text-muted-foreground">[]</span>
				</div>
			)
		}

		return (
			<div style={{ paddingLeft: `${indent}px` }}>
				<button
					aria-label={toggleLabel}
					aria-expanded={isExpanded}
					onClick={() => setIsExpanded(!isExpanded)}
					className="flex items-center gap-1 text-sm hover:bg-accent/50 rounded px-1 -ml-1"
				>
					{isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
					{propertyName && <span className="text-primary font-medium">{propertyName}: </span>}
					<span className="text-muted-foreground">[{formatNumber(data.length)}]</span>
				</button>
				{isExpanded && (
					<div className="mt-1">
						{data.map((item, index) => (
							<JsonNode
								key={index}
								data={item}
								level={level + 1}
								defaultExpanded={defaultExpanded}
								propertyName={String(index)}
							/>
						))}
					</div>
				)}
			</div>
		)
	}

	if (typeof data === 'object') {
		const entries = Object.entries(data)

		if (entries.length === 0) {
			return (
				<div style={{ paddingLeft: `${indent}px` }} className="text-sm">
					{propertyName && <span className="text-primary font-medium">{propertyName}: </span>}
					<span className="text-muted-foreground">{'{}'}</span>
				</div>
			)
		}

		return (
			<div style={{ paddingLeft: `${indent}px` }}>
				<button
					aria-label={toggleLabel}
					aria-expanded={isExpanded}
					onClick={() => setIsExpanded(!isExpanded)}
					className="flex items-center gap-1 text-sm hover:bg-accent/50 rounded px-1 -ml-1"
				>
					{isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
					{propertyName && <span className="text-primary font-medium">{propertyName}: </span>}
					<span className="text-muted-foreground">
						{'{'} {t('common.jsonViewer.properties', { count: entries.length })} {'}'}
					</span>
				</button>
				{isExpanded && (
					<div className="mt-1">
						{entries.map(([key, value]) => (
							<JsonNode
								key={key}
								data={value}
								level={level + 1}
								defaultExpanded={defaultExpanded}
								propertyName={key}
							/>
						))}
					</div>
				)}
			</div>
		)
	}

	return (
		<div style={{ paddingLeft: `${indent}px` }} className="text-sm">
			{propertyName && <span className="text-primary font-medium">{propertyName}: </span>}
			<span className="text-muted-foreground">{String(data)}</span>
		</div>
	)
}

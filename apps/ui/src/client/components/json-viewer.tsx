import { useState } from 'react'
import { ChevronDown, ChevronRight, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface JsonViewerProps {
	data: unknown
	defaultExpanded?: boolean
	maxHeight?: string
}

export function JsonViewer({ data, defaultExpanded = false, maxHeight = '400px' }: JsonViewerProps) {
	const [copied, setCopied] = useState(false)

	const handleCopy = () => {
		navigator.clipboard.writeText(JSON.stringify(data, null, 2))
		setCopied(true)
		setTimeout(() => setCopied(false), 2000)
	}

	if (data === null || data === undefined) {
		return (
			<div className="text-sm text-muted-foreground italic p-2 border border-border rounded-md bg-muted/30">
				No data
			</div>
		)
	}

	return (
		<div className="relative border border-border rounded-md bg-muted/30">
			<div className="absolute top-2 right-2 z-10">
				<Button variant="ghost" size="sm" onClick={handleCopy}>
					<Copy className="h-3 w-3 mr-1" />
					{copied ? 'Copied!' : 'Copy'}
				</Button>
			</div>
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
	const [isExpanded, setIsExpanded] = useState(defaultExpanded)

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
					onClick={() => setIsExpanded(!isExpanded)}
					className="flex items-center gap-1 text-sm hover:bg-accent/50 rounded px-1 -ml-1"
				>
					{isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
					{propertyName && <span className="text-primary font-medium">{propertyName}: </span>}
					<span className="text-muted-foreground">[{data.length}]</span>
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
					onClick={() => setIsExpanded(!isExpanded)}
					className="flex items-center gap-1 text-sm hover:bg-accent/50 rounded px-1 -ml-1"
				>
					{isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
					{propertyName && <span className="text-primary font-medium">{propertyName}: </span>}
					<span className="text-muted-foreground">
						{'{'} {entries.length} {entries.length === 1 ? 'property' : 'properties'} {'}'}
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

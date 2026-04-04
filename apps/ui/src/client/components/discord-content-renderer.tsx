import { useState } from 'react'

import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import {
	formatDiscordTimestamp,
	formatFullTimestampTooltip,
	formatIsoTimestamp,
} from '@/lib/discord-time'

import type { ReactNode } from 'react'

function TimestampChip({
	displayText,
	fullTimestamp,
}: {
	displayText: string
	fullTimestamp: string
}) {
	const [open, setOpen] = useState(false)

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverAnchor asChild>
				<span
					className="inline-block rounded bg-accent px-1.5 py-0.5 text-[0.875em] leading-none align-baseline cursor-help transition-colors hover:bg-accent/90"
					onMouseEnter={() => setOpen(true)}
					onMouseLeave={() => setOpen(false)}
				>
					{displayText}
				</span>
			</PopoverAnchor>
			<PopoverContent
				side="top"
				align="center"
				sideOffset={6}
				className="w-max max-w-[28rem] px-2 py-1 text-xs"
				onOpenAutoFocus={(event) => event.preventDefault()}
				onMouseEnter={() => setOpen(true)}
				onMouseLeave={() => setOpen(false)}
			>
				{fullTimestamp}
			</PopoverContent>
		</Popover>
	)
}

function renderTimestampToken(token: string, key: string): ReactNode {
	const match = token.match(/^<t:(\d+)(?::([tTdDfFR]))?>$/)
	if (!match) return token

	const unix = Number(match[1])
	if (!Number.isFinite(unix)) return token

	const date = new Date(unix * 1000)
	const fullTimestamp = formatFullTimestampTooltip(date)
	const displayText = formatDiscordTimestamp(date, match[2])

	return <TimestampChip key={key} displayText={displayText} fullTimestamp={fullTimestamp} />
}

function renderIsoTimestampToken(token: string, key: string): ReactNode {
	const date = new Date(token)
	if (Number.isNaN(date.getTime())) return token
	return (
		<TimestampChip
			key={key}
			displayText={formatIsoTimestamp(date)}
			fullTimestamp={formatFullTimestampTooltip(date)}
		/>
	)
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
	const tokenRegex =
		/(<t:\d+(?::[tTdDfFR])?>|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})|`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\*[^*]+\*|_[^_]+_)/g
	const matches = [...text.matchAll(tokenRegex)]
	if (matches.length === 0) return [text]

	const out: ReactNode[] = []
	let cursor = 0
	for (let i = 0; i < matches.length; i++) {
		const match = matches[i]
		const token = match[0]
		const index = match.index ?? 0
		if (index > cursor) out.push(text.slice(cursor, index))

		const tokenKey = `${keyPrefix}-token-${i}`
		if (token.startsWith('<t:')) {
			out.push(renderTimestampToken(token, tokenKey))
		} else if (/^\d{4}-\d{2}-\d{2}T/.test(token)) {
			out.push(renderIsoTimestampToken(token, tokenKey))
		} else if (token.startsWith('`') && token.endsWith('`')) {
			out.push(
				<code key={tokenKey} className="rounded bg-muted px-1 py-0.5 text-xs font-mono">
					{token.slice(1, -1)}
				</code>
			)
		} else if (token.startsWith('**') && token.endsWith('**')) {
			out.push(<strong key={tokenKey}>{renderInline(token.slice(2, -2), tokenKey)}</strong>)
		} else if (token.startsWith('__') && token.endsWith('__')) {
			out.push(<u key={tokenKey}>{renderInline(token.slice(2, -2), tokenKey)}</u>)
		} else if (token.startsWith('~~') && token.endsWith('~~')) {
			out.push(<s key={tokenKey}>{renderInline(token.slice(2, -2), tokenKey)}</s>)
		} else if (
			(token.startsWith('*') && token.endsWith('*')) ||
			(token.startsWith('_') && token.endsWith('_'))
		) {
			out.push(<em key={tokenKey}>{renderInline(token.slice(1, -1), tokenKey)}</em>)
		} else {
			out.push(token)
		}
		cursor = index + token.length
	}
	if (cursor < text.length) out.push(text.slice(cursor))
	return out
}

function renderMarkdownText(text: string, keyPrefix: string): ReactNode {
	const lines = text.split('\n')
	const renderedLines: ReactNode[] = []
	let isMultiLineQuote = false

	lines.forEach((line, lineIndex) => {
		const lineKey = `${keyPrefix}-line-${lineIndex}`
		let content = line

		if (content.startsWith('>>>')) {
			isMultiLineQuote = true
			content = content.replace(/^>>>\s?/, '')
		}

		if (isMultiLineQuote) {
			renderedLines.push(
				<div
					key={lineKey}
					className="border-l-2 border-border pl-2 text-muted-foreground italic min-h-5"
				>
					{content ? renderInline(content, lineKey) : '\u00A0'}
				</div>
			)
			return
		}

		if (/^\s*$/.test(content)) {
			renderedLines.push(<div key={lineKey} className="h-2" />)
			return
		}

		if (content.startsWith('> ')) {
			renderedLines.push(
				<div key={lineKey} className="border-l-2 border-border pl-2 text-muted-foreground italic">
					{renderInline(content.slice(2), lineKey)}
				</div>
			)
			return
		}

		if (content.startsWith('-### ')) {
			renderedLines.push(
				<div key={lineKey} className="text-[10px] text-muted-foreground">
					{renderInline(content.slice(5), lineKey)}
				</div>
			)
			return
		}

		if (content.startsWith('-## ')) {
			renderedLines.push(
				<div key={lineKey} className="text-[11px] text-muted-foreground">
					{renderInline(content.slice(4), lineKey)}
				</div>
			)
			return
		}

		if (content.startsWith('-# ')) {
			renderedLines.push(
				<div key={lineKey} className="text-xs text-muted-foreground">
					{renderInline(content.slice(3), lineKey)}
				</div>
			)
			return
		}

		if (content.startsWith('### ')) {
			renderedLines.push(
				<div key={lineKey} className="text-base font-semibold">
					{renderInline(content.slice(4), lineKey)}
				</div>
			)
			return
		}

		if (content.startsWith('## ')) {
			renderedLines.push(
				<div key={lineKey} className="text-lg font-semibold">
					{renderInline(content.slice(3), lineKey)}
				</div>
			)
			return
		}

		if (content.startsWith('# ')) {
			renderedLines.push(
				<div key={lineKey} className="text-xl font-semibold">
					{renderInline(content.slice(2), lineKey)}
				</div>
			)
			return
		}

		const bulletMatch = content.match(/^\s*[-*]\s+(.+)$/)
		if (bulletMatch) {
			renderedLines.push(
				<div key={lineKey} className="flex items-start gap-2">
					<span className="text-muted-foreground">•</span>
					<span>{renderInline(bulletMatch[1], lineKey)}</span>
				</div>
			)
			return
		}

		const numberedMatch = content.match(/^\s*(\d+)\.\s+(.+)$/)
		if (numberedMatch) {
			renderedLines.push(
				<div key={lineKey} className="flex items-start gap-2">
					<span className="text-muted-foreground">{numberedMatch[1]}.</span>
					<span>{renderInline(numberedMatch[2], lineKey)}</span>
				</div>
			)
			return
		}

		renderedLines.push(<div key={lineKey}>{renderInline(content, lineKey)}</div>)
	})

	return <div className="space-y-1">{renderedLines}</div>
}

function renderDiscordMarkdown(value: string, keyPrefix: string): ReactNode {
	const parts = value.split(/(```[\s\S]*?```)/g)
	return (
		<>
			{parts.map((part, index) => {
				const partKey = `${keyPrefix}-part-${index}`
				if (part.startsWith('```') && part.endsWith('```')) {
					const codeContent = part.slice(3, -3).replace(/^\n/, '')
					return (
						<pre
							key={partKey}
							className="my-2 overflow-x-auto rounded-md bg-muted p-3 text-xs font-mono"
						>
							<code>{codeContent}</code>
						</pre>
					)
				}
				return <span key={partKey}>{renderMarkdownText(part, partKey)}</span>
			})}
		</>
	)
}

export function renderDiscordContentValue(value: unknown, keyPrefix: string): ReactNode {
	if (value === null || value === undefined) return '-'
	if (typeof value === 'string') return renderDiscordMarkdown(value, keyPrefix)
	if (typeof value === 'number' || typeof value === 'boolean') return String(value)
	if (Array.isArray(value)) {
		return (
			<div className="space-y-1">
				{value.map((item, index) => (
					<div key={`${keyPrefix}-arr-${index}`}>
						{renderDiscordContentValue(item, `${keyPrefix}-${index}`)}
					</div>
				))}
			</div>
		)
	}
	return (
		<pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs font-mono">
			<code>{JSON.stringify(value, null, 2)}</code>
		</pre>
	)
}

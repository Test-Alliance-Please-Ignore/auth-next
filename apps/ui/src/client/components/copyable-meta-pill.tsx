import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

import toast from '@/lib/toast'
import { cn } from '@/lib/utils'

interface CopyableMetaPillProps {
	label: string
	value: string
	copyValue?: string
	className?: string
}

export function CopyableMetaPill({ label, value, copyValue, className }: CopyableMetaPillProps) {
	const [copied, setCopied] = useState(false)

	const handleCopy = () => {
		void navigator.clipboard
			.writeText(copyValue ?? value)
			.then(() => {
				toast.success(`${label} copied`)
				setCopied(true)
				window.setTimeout(() => {
					setCopied(false)
				}, 1800)
			})
			.catch(() => {
				toast.error(`Failed to copy ${label.toLowerCase()}`)
			})
	}

	return (
		<button
			type="button"
			onClick={handleCopy}
			className={cn(
				'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-copy',
				copied
					? 'border-emerald-500/60 bg-emerald-500/15 text-muted-foreground'
					: 'border-border/60 bg-background/80 text-muted-foreground hover:border-primary/40',
				className
			)}
			aria-label={`Copy ${label} to clipboard`}
			title={copied ? 'Copied' : `Copy ${label}`}
		>
			<span className="shrink-0 font-medium uppercase tracking-wide text-[10px] text-muted-foreground">
				{label}
			</span>
			<span className="max-w-[18rem] truncate font-mono text-[11px] font-semibold text-foreground dark:text-white">
				{value}
			</span>
			{copied ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Copy className="h-3.5 w-3.5" />}
		</button>
	)
}

export type { CopyableMetaPillProps }

import { Check, Copy } from 'lucide-react'
import { useRef, useState } from 'react'

import { i18n, useAppTranslation } from '@/i18n'
import toast from '@/lib/toast'
import { cn } from '@/lib/utils'

interface CopyableMetaPillProps {
	label: string
	value: string
	copyValue?: string
	className?: string
}

export function CopyableMetaPill({ label, value, copyValue, className }: CopyableMetaPillProps) {
	const { t } = useAppTranslation()
	const labelRef = useRef(label)
	labelRef.current = label
	const [copied, setCopied] = useState(false)

	const handleCopy = () => {
		void navigator.clipboard
			.writeText(copyValue ?? value)
			.then(() => {
				toast.success(i18n.t('metaPill.copySuccess', { label: labelRef.current }))
				setCopied(true)
				window.setTimeout(() => {
					setCopied(false)
				}, 1800)
			})
			.catch(() => {
				toast.error(i18n.t('metaPill.copyFailed', { label: labelRef.current }))
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
			aria-label={t('metaPill.copyAria', { label })}
			title={copied ? t('common.characterIdentity.copied') : t('metaPill.copy', { label })}
		>
			<span className="shrink-0 font-medium uppercase tracking-wide text-[10px] text-muted-foreground">
				{label}
			</span>
			<span className="max-w-[18rem] truncate font-mono text-[11px] font-semibold text-foreground dark:text-white">
				{value}
			</span>
			{copied ? (
				<Check className="h-3.5 w-3.5 text-emerald-300" />
			) : (
				<Copy className="h-3.5 w-3.5" />
			)}
		</button>
	)
}

export type { CopyableMetaPillProps }

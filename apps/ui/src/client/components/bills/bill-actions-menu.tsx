import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useAppTranslation } from '@/i18n'
import { cn } from '@/lib/utils'

export type BillActionIntent = 'confirm' | 'secondary' | 'muted' | 'destructive' | 'primary'

export interface BillActionItem {
	id?: string
	label: string
	intent: BillActionIntent
	hidden?: boolean
	loading?: boolean
	onClick?: () => void
	href?: string
}

const intentBg: Record<BillActionIntent, string> = {
	confirm: 'bg-[hsl(var(--confirm))]/45 hover:bg-[hsl(var(--confirm))]/65',
	destructive: 'bg-[hsl(var(--destructive-alt))]/45 hover:bg-[hsl(var(--destructive-alt))]/65',
	muted: 'bg-white/15 hover:bg-[hsl(var(--cancel-hover))]/65',
	secondary: 'bg-[hsl(var(--secondary))]/45 hover:bg-[hsl(var(--secondary))]/65',
	primary: 'bg-[hsl(var(--primary))]/45 hover:bg-[hsl(var(--primary))]/65',
}

export function BillActionsMenu(props: { items: BillActionItem[] }) {
	const { t } = useAppTranslation()
	const [open, setOpen] = useState(false)
	const visible = props.items.filter((item) => !item.hidden)

	if (visible.length === 0) return null

	const run = (item: BillActionItem) => {
		setOpen(false)
		item.onClick?.()
	}

	if (visible.length === 1) {
		const item = visible[0]
		if (item.href && !item.loading) {
			return (
				<Button variant={item.intent === 'primary' ? 'primary' : 'ghost'} size="sm" asChild>
					<Link to={item.href}>{item.label}</Link>
				</Button>
			)
		}
		return (
			<Button
				variant={item.intent === 'primary' ? 'primary' : 'ghost'}
				size="sm"
				type="button"
				disabled={item.loading}
				onClick={() => run(item)}
			>
				{item.loading ? t('common.loading') : item.label}
			</Button>
		)
	}

	const baseClass =
		'flex min-h-9 w-full cursor-pointer items-center px-3 py-2 whitespace-normal text-left !text-sm !font-medium !leading-5 text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 first:rounded-t last:rounded-b'

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button variant="ghost" size="sm" type="button">
					{t('bills.columns.actions')} <ChevronDown className="ml-1 h-3 w-3" />
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-56 max-w-[calc(100vw-2rem)] p-1">
				{visible.map((item) =>
					item.href && !item.loading ? (
						<Button
							key={item.id ?? item.label}
							variant="ghost"
							size="sm"
							asChild
							className={cn(
								baseClass,
								'justify-start rounded-none !border-0 !shadow-none',
								intentBg[item.intent]
							)}
						>
							<Link to={item.href} onClick={() => setOpen(false)}>
								{item.label}
							</Link>
						</Button>
					) : (
						<button
							key={item.id ?? item.label}
							type="button"
							disabled={item.loading}
							className={cn(baseClass, intentBg[item.intent])}
							onClick={() => run(item)}
						>
							{item.loading ? t('common.loading') : item.label}
						</button>
					)
				)}
			</PopoverContent>
		</Popover>
	)
}

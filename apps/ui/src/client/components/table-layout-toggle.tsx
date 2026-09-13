import { Maximize2, Minimize2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useAppTranslation } from '@/i18n'

export function TableLayoutToggle(props: { isClamped: boolean; onToggle: () => void }) {
	const { t } = useAppTranslation()
	const hint = t(props.isClamped ? 'common.table.pageScrollHint' : 'common.table.clampGridHint')
	return (
		<Button
			variant="ghost"
			size="default"
			type="button"
			onClick={props.onToggle}
			aria-pressed={props.isClamped}
			aria-label={hint}
			title={hint}
		>
			{props.isClamped ? <Maximize2 className="h-4 w-4" /> : <Minimize2 className="h-4 w-4" />}
			<span className="ml-2">
				{t(props.isClamped ? 'common.table.pageScroll' : 'common.table.clampGrid')}
			</span>
		</Button>
	)
}

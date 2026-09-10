import { Maximize2, Minimize2 } from 'lucide-react'

import { Button } from '@/components/ui/button'

export function TableLayoutToggle(props: { isClamped: boolean; onToggle: () => void }) {
	return (
		<Button
			variant="ghost"
			size="default"
			type="button"
			onClick={props.onToggle}
			aria-pressed={props.isClamped}
			aria-label={
				props.isClamped ? 'Use page scrolling for the table' : 'Clamp the table to the page'
			}
			title={props.isClamped ? 'Use page scrolling for the table' : 'Clamp the table to the page'}
		>
			{props.isClamped ? <Maximize2 className="h-4 w-4" /> : <Minimize2 className="h-4 w-4" />}
			<span className="ml-2">{props.isClamped ? 'Page scroll' : 'Clamp grid'}</span>
		</Button>
	)
}

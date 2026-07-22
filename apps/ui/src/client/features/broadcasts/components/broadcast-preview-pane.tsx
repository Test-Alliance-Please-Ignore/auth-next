import { renderDiscordContentValue } from '@/components/discord-content-renderer'
import { Label } from '@/components/ui/label'

interface BroadcastPreviewPaneProps {
	message: string
}

export function BroadcastPreviewPane({ message }: BroadcastPreviewPaneProps) {
	return (
		<div className="min-w-0 max-w-full space-y-2 lg:self-stretch">
			<Label className="text-sm font-medium">Preview</Label>
			<div className="h-full min-h-[16rem] max-w-full overflow-y-auto overflow-x-hidden rounded-md border border-border bg-muted/20 p-3 text-sm break-words [overflow-wrap:anywhere] [&_pre]:max-w-full [&_pre]:whitespace-pre-wrap [&_pre]:break-words">
				{message.trim() ? (
					renderDiscordContentValue(message, 'preview')
				) : (
					<span className="text-muted-foreground italic">Preview will appear here…</span>
				)}
			</div>
		</div>
	)
}

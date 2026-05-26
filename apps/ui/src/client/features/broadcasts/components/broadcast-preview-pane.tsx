import { renderDiscordContentValue } from '@/components/discord-content-renderer'
import { Label } from '@/components/ui/label'

interface BroadcastPreviewPaneProps {
	message: string
}

export function BroadcastPreviewPane({ message }: BroadcastPreviewPaneProps) {
	return (
		<div className="[grid-area:preview] space-y-2 lg:self-stretch">
			<Label className="text-sm font-medium">Preview</Label>
			<div className="rounded-md border border-border bg-muted/20 p-3 text-sm overflow-y-auto min-h-[16rem] h-full">
				{message.trim() ? (
					renderDiscordContentValue(message, 'preview')
				) : (
					<span className="text-muted-foreground italic">Preview will appear here…</span>
				)}
			</div>
		</div>
	)
}

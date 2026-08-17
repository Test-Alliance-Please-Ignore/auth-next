import { Search } from 'lucide-react'

import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'

import { HrUserSearchContent } from '../../applications/components/hr-user-search-content'

interface CorporationUserSearchDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
}

export function CorporationUserSearchDialog({
	open,
	onOpenChange,
}: CorporationUserSearchDialogProps) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-5xl">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Search className="h-5 w-5" />
						User Search
					</DialogTitle>
					<DialogDescription>
						Search by character name, character ID, Discord username, or Discord ID to review the
						linked characters on the account.
					</DialogDescription>
				</DialogHeader>

				<HrUserSearchContent autoFocus enabled={open} />
			</DialogContent>
		</Dialog>
	)
}

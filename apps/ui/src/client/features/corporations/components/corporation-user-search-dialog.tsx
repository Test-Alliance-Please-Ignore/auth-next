import { Search } from 'lucide-react'

import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { useAppTranslation } from '@/i18n'

import { HrUserSearchContent } from '../../applications/components/hr-user-search-content'

interface CorporationUserSearchDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
}

export function CorporationUserSearchDialog({
	open,
	onOpenChange,
}: CorporationUserSearchDialogProps) {
	const { t } = useAppTranslation()

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-5xl">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Search className="h-5 w-5" />
						{t('corporations.userSearch.title')}
					</DialogTitle>
					<DialogDescription>{t('corporations.userSearch.description')}</DialogDescription>
				</DialogHeader>

				<HrUserSearchContent autoFocus enabled={open} />
			</DialogContent>
		</Dialog>
	)
}

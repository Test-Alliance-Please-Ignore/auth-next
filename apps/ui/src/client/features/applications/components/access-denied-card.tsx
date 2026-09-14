import { AlertCircle, ArrowLeft } from 'lucide-react'
import { Link } from 'react-router'

import { Button } from '@/components/ui/button'
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from '@/components/ui/card'
import { useAppTranslation } from '@/i18n'

interface AccessDeniedCardProps {
	title?: string
	message?: string
	backLabel?: string
	/** Use for proper link navigation (supports right-click "Open in new tab") */
	backHref?: string
	/** @deprecated Prefer backHref for proper link support */
	onBack?: () => void
}

export function AccessDeniedCard({
	title,
	message,
	backLabel,
	backHref,
	onBack,
}: AccessDeniedCardProps) {
	const { t } = useAppTranslation()
	const backButton = backHref ? (
		<Button asChild variant="ghost">
			<Link to={backHref}>
				<ArrowLeft className="h-4 w-4" />
				{backLabel ?? t('applications.access.back')}
			</Link>
		</Button>
	) : onBack ? (
		<Button variant="ghost" onClick={onBack}>
			<ArrowLeft className="h-4 w-4" />
			{backLabel ?? t('applications.access.back')}
		</Button>
	) : null

	return (
		<Card className="max-w-2xl mx-auto border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950">
			<CardHeader className="text-center">
				<AlertCircle className="h-16 w-16 mx-auto text-red-500 mb-4" />
				<CardTitle className="text-2xl text-red-900 dark:text-red-100">
					{title ?? t('applications.access.title')}
				</CardTitle>
				<CardDescription className="mt-2 text-red-700 dark:text-red-300">
					{message ?? t('applications.access.message')}
				</CardDescription>
			</CardHeader>
			{backButton ? (
				<CardContent className="text-center">{backButton}</CardContent>
			) : (
				<CardFooter className="justify-center">
					<Button variant="ghost" onClick={() => window.history.back()}>
						<ArrowLeft className="h-4 w-4" />
						{backLabel ?? t('applications.access.back')}
					</Button>
				</CardFooter>
			)}
		</Card>
	)
}

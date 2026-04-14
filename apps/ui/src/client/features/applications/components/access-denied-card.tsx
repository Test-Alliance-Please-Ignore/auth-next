import { AlertCircle, ArrowLeft } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'

interface AccessDeniedCardProps {
	title?: string
	message?: string
	backLabel?: string
	onBack?: () => void
}

export function AccessDeniedCard({
	title = 'Access Denied',
	message = 'You do not have access to this resource.',
	backLabel = 'Go Back',
	onBack,
}: AccessDeniedCardProps) {
	return (
		<Card className="max-w-2xl mx-auto border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950">
			<CardHeader className="text-center">
				<AlertCircle className="h-16 w-16 mx-auto text-red-500 mb-4" />
				<CardTitle className="text-2xl text-red-900 dark:text-red-100">{title}</CardTitle>
				<CardDescription className="mt-2 text-red-700 dark:text-red-300">{message}</CardDescription>
			</CardHeader>
			{onBack && (
				<CardContent className="text-center">
					<Button variant="ghost" onClick={onBack}>
						<ArrowLeft className="h-4 w-4" />
						{backLabel}
					</Button>
				</CardContent>
			)}
			{!onBack && (
				<CardFooter className="justify-center">
					<Button variant="ghost" onClick={() => window.history.back()}>
						<ArrowLeft className="h-4 w-4" />
						{backLabel}
					</Button>
				</CardFooter>
			)}
		</Card>
	)
}

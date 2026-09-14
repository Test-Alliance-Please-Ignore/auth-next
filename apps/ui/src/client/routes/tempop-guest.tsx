import { useQuery } from '@tanstack/react-query'
import { LogIn, Mic } from 'lucide-react'
import { useState } from 'react'
import { useParams, useSearchParams } from 'react-router'

import { LocalePicker } from '@/components/locale-picker'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/ui/page-header'
import { OneTimeCredentialsCard } from '@/features/mumble/components/credentials-card'
import { MumbleFeedback } from '@/features/mumble/components/feedback'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useAppTranslation } from '@/i18n'
import { apiClient } from '@/lib/api'
import toast from '@/lib/toast'

import type { ReactNode } from 'react'
import type { AppTranslationKey } from '@/i18n'

const ERROR_MESSAGES: Record<string, AppTranslationKey> = {
	sso: 'mumble.guest.errors.sso',
	expired: 'mumble.guest.errors.expired',
	blacklisted: 'mumble.guest.errors.blacklisted',
	provision: 'mumble.guest.errors.provision',
	invalid: 'mumble.guest.errors.invalid',
}

function MessageCard({ title, message }: { title: string; message: string }) {
	return (
		<Card variant="default" className="border-destructive/50">
			<CardHeader>
				<CardTitle>{title}</CardTitle>
			</CardHeader>
			<CardContent className="text-sm text-muted-foreground">{message}</CardContent>
		</Card>
	)
}

export default function TempopGuestPage() {
	const { t } = useAppTranslation()
	usePageTitle(t('mumble.guest.title'))
	const { key = '' } = useParams<{ key: string }>()
	const [searchParams] = useSearchParams()
	const provisioned = searchParams.get('provisioned') === '1'
	const handoff = searchParams.get('h')
	const errorCode = searchParams.get('error')
	const [starting, setStarting] = useState(false)

	const infoQuery = useQuery({
		queryKey: ['tempop-info', key],
		queryFn: () => apiClient.getTempopInfo(key),
		enabled: key.length > 0 && !provisioned,
		retry: false,
	})

	// One-time handoff exchange — single use. The handoff is consumed server-side
	// on first fetch, and we drop the result from cache as soon as the page
	// unmounts (gcTime: 0) so the password can't be re-shown on back-navigation
	// or remount; a remount re-fetches and the now-consumed handoff returns 404.
	// We never refetch within the same view, so the credentials stay visible
	// while the page is open.
	const credentialsQuery = useQuery({
		queryKey: ['tempop-credentials', key, handoff],
		queryFn: () => apiClient.getTempopCredentials(key, handoff ?? ''),
		enabled: provisioned && !!handoff,
		retry: false,
		gcTime: 0,
		refetchOnWindowFocus: false,
		refetchOnMount: false,
	})

	const handleIdentify = async () => {
		if (starting) return
		setStarting(true)
		try {
			const { authorizationUrl } = await apiClient.startTempopSso(key)
			window.location.href = authorizationUrl
		} catch (error) {
			toast.error(
				error instanceof Error && error.message ? (
					error.message
				) : (
					<MumbleFeedback messageKey="mumble.feedback.loginFailed" />
				)
			)
			setStarting(false)
		}
	}

	let content: ReactNode
	if (errorCode) {
		content = (
			<MessageCard
				title={t('mumble.guest.unable')}
				message={t(
					Object.hasOwn(ERROR_MESSAGES, errorCode)
						? ERROR_MESSAGES[errorCode]
						: 'mumble.guest.errors.unknown'
				)}
			/>
		)
	} else if (provisioned) {
		if (credentialsQuery.isLoading) {
			content = <p className="text-muted-foreground">{t('mumble.guest.preparing')}</p>
		} else if (credentialsQuery.data) {
			content = <OneTimeCredentialsCard credentials={credentialsQuery.data} />
		} else {
			content = (
				<MessageCard
					title={t('mumble.guest.unavailable')}
					message={t('mumble.guest.retryHandoff')}
				/>
			)
		}
	} else if (infoQuery.isLoading) {
		content = <p className="text-muted-foreground">{t('common.loading')}</p>
	} else if (infoQuery.error || !infoQuery.data?.valid) {
		content = (
			<MessageCard
				title={
					infoQuery.data?.expired ? t('mumble.guest.expiredTitle') : t('mumble.guest.invalidTitle')
				}
				message={
					infoQuery.data?.expired
						? t('mumble.guest.errors.expired')
						: t('mumble.guest.invalidDescription')
				}
			/>
		)
	} else {
		content = (
			<Card variant="default">
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<Mic className="h-5 w-5" />
						{t('mumble.guest.title')}
					</CardTitle>
					<CardDescription>{t('mumble.guest.loginDescription')}</CardDescription>
				</CardHeader>
				<CardContent>
					<Button onClick={handleIdentify} disabled={starting} className="gap-2">
						<LogIn className="h-4 w-4" />
						{starting ? t('mumble.guest.redirecting') : t('mumble.guest.identify')}
					</Button>
				</CardContent>
			</Card>
		)
	}

	return (
		<Container>
			<PageHeader
				className="[&>div]:flex-wrap"
				title={t('mumble.guest.header')}
				description={t('mumble.guest.description')}
				action={
					<div className="w-44">
						<LocalePicker />
					</div>
				}
			/>
			<div className="mt-4 max-w-xl space-y-4">{content}</div>
		</Container>
	)
}

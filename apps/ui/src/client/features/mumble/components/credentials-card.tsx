import { Check, Copy, ExternalLink, KeyRound } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAppTranslation } from '@/i18n'
import toast from '@/lib/toast'

import { MumbleFeedback } from './feedback'

import type { AppTranslationKey } from '@/i18n'
import type { MumbleOneTimeCredentials } from '../types'

/** Build a `mumble://user:pass@host:port/` connect URL. */
export function buildMumbleUrl(credentials: MumbleOneTimeCredentials): string {
	const username = encodeURIComponent(credentials.loginName)
	const password = encodeURIComponent(credentials.password)
	const host = encodeURIComponent(credentials.connection.host)
	return `mumble://${username}:${password}@${host}:${credentials.connection.port}/`
}

/** A click-to-copy row used for credentials and generated links. */
export function CopyRow({ labelKey, value }: { labelKey: AppTranslationKey; value: string }) {
	const { t } = useAppTranslation()
	const label = t(labelKey)
	const [copied, setCopied] = useState(false)
	const resetTimerRef = useRef<number | null>(null)

	useEffect(() => {
		return () => {
			if (resetTimerRef.current !== null) {
				window.clearTimeout(resetTimerRef.current)
			}
		}
	}, [])

	const onCopy = async () => {
		try {
			await navigator.clipboard.writeText(value)
			toast.success(<MumbleFeedback messageKey="mumble.feedback.copied" labelKey={labelKey} />)
			setCopied(true)
			if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current)
			resetTimerRef.current = window.setTimeout(() => {
				setCopied(false)
				resetTimerRef.current = null
			}, 2000)
		} catch {
			toast.error(<MumbleFeedback messageKey="mumble.feedback.copyFailed" labelKey={labelKey} />)
		}
	}

	return (
		<div className="flex items-center gap-2">
			<span className="w-24 shrink-0 text-xs text-muted-foreground">{label}</span>
			<button
				type="button"
				aria-label={t('mumble.credentials.copy', { label })}
				onClick={() => void onCopy()}
				className={`flex min-w-0 flex-1 text-left cursor-pointer items-center gap-2.5 rounded-md border-2 px-3 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
					copied
						? 'border-teal-500 bg-teal-500/30 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)]'
						: 'border-zinc-500/50 bg-zinc-500/20 shadow-sm hover:border-zinc-500/70 hover:bg-zinc-500/30'
				}`}
			>
				<Copy className="h-4 w-4 shrink-0 text-muted-foreground" />
				<span className="min-w-0 break-all font-mono text-base">{value}</span>
				{copied ? <Check className="h-4 w-4 shrink-0 text-teal-300" /> : null}
			</button>
		</div>
	)
}

/** One-time credentials card shown after provisioning or a password reset. */
export function OneTimeCredentialsCard({ credentials }: { credentials: MumbleOneTimeCredentials }) {
	const { t } = useAppTranslation()
	const mumbleUrl = buildMumbleUrl(credentials)
	const server = credentials.connection.host
	const port = String(credentials.connection.port)

	return (
		<Card variant="default" className="border-amber-500/50">
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<KeyRound className="h-5 w-5" />
					{t('mumble.credentials.title')}
				</CardTitle>
				<CardDescription>{t('mumble.credentials.description')}</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3">
				<div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
					{t('mumble.credentials.warning')}
				</div>
				<CopyRow labelKey="mumble.credentials.username" value={credentials.loginName} />
				<CopyRow labelKey="common.password" value={credentials.password} />
				<CopyRow labelKey="mumble.credentials.server" value={server} />
				<CopyRow labelKey="mumble.credentials.port" value={port} />
				<div className="pt-3">
					<Button asChild variant="primary" className="justify-center gap-2">
						<a href={mumbleUrl}>
							<ExternalLink className="h-4 w-4" />
							{t('mumble.credentials.connect')}
						</a>
					</Button>
				</div>
			</CardContent>
		</Card>
	)
}

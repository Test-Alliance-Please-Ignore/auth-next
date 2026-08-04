import { Check, Copy, ExternalLink, KeyRound } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import toast from '@/lib/toast'

import type { MumbleOneTimeCredentials } from '../types'

/** Build a `mumble://user:pass@host:port/` connect URL. */
export function buildMumbleUrl(credentials: MumbleOneTimeCredentials): string {
	const username = encodeURIComponent(credentials.loginName)
	const password = encodeURIComponent(credentials.password)
	const host = encodeURIComponent(credentials.connection.host)
	return `mumble://${username}:${password}@${host}:${credentials.connection.port}/`
}

/** A click-to-copy row used for credentials and generated links. */
export function CopyRow({ label, value }: { label: string; value: string }) {
	const [copied, setCopied] = useState(false)
	const resetTimerRef = useRef<number | null>(null)

	useEffect(() => {
		return () => {
			if (resetTimerRef.current !== null) {
				window.clearTimeout(resetTimerRef.current)
			}
		}
	}, [])

	const onCopy = () => {
		void navigator.clipboard.writeText(value).then(() => {
			toast.success(`${label} copied`)
			setCopied(true)
			if (resetTimerRef.current !== null) {
				window.clearTimeout(resetTimerRef.current)
			}
			resetTimerRef.current = window.setTimeout(() => {
				setCopied(false)
				resetTimerRef.current = null
			}, 2000)
		})
	}

	return (
		<div className="flex items-center gap-2">
			<span className="w-20 shrink-0 text-xs text-muted-foreground">{label}</span>
			<div
				role="button"
				tabIndex={0}
				onClick={onCopy}
				onKeyDown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault()
						onCopy()
					}
				}}
				className={`flex cursor-pointer items-center gap-2.5 rounded-md border-2 px-3 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
					copied
						? 'border-teal-500 bg-teal-500/30 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)]'
						: 'border-zinc-500/50 bg-zinc-500/20 shadow-sm hover:border-zinc-500/70 hover:bg-zinc-500/30'
				}`}
			>
				<Copy className="h-4 w-4 shrink-0 text-muted-foreground" />
				<span className="break-all font-mono text-base">{value}</span>
				{copied ? <Check className="h-4 w-4 shrink-0 text-teal-300" /> : null}
			</div>
		</div>
	)
}

/** One-time credentials card shown after provisioning or a password reset. */
export function OneTimeCredentialsCard({ credentials }: { credentials: MumbleOneTimeCredentials }) {
	const mumbleUrl = buildMumbleUrl(credentials)
	const server = credentials.connection.host
	const port = String(credentials.connection.port)

	return (
		<Card variant="default" className="border-amber-500/50">
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<KeyRound className="h-5 w-5" />
					Your Mumble credentials
				</CardTitle>
				<CardDescription>
					The password below is shown only once and cannot be recovered. Save the server, username,
					and password somewhere safe before you leave this page.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3">
				<div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
					Once you close or refresh this page, the password will no longer be visible. If you lose
					it, you will need to generate a new one.
				</div>
				<CopyRow label="Username" value={credentials.loginName} />
				<CopyRow label="Password" value={credentials.password} />
				<CopyRow label="Server" value={server} />
				<CopyRow label="Port" value={port} />
				<div className="pt-3">
					<Button asChild variant="primary" className="justify-center gap-2">
						<a href={mumbleUrl}>
							<ExternalLink className="h-4 w-4" />
							Connect in Mumble
						</a>
					</Button>
				</div>
			</CardContent>
		</Card>
	)
}

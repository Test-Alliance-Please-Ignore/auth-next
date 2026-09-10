import { Ticket } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useRedeemInviteCode } from '@/hooks/useGroups'
import { useAppTranslation } from '@/i18n'

import type { FormEvent } from 'react'
import type { AppTranslationKey } from '@/i18n'

interface InviteCodeRedemptionProps {
	onSuccess?: () => void
}

export function InviteCodeRedemption({ onSuccess }: InviteCodeRedemptionProps) {
	const { t } = useAppTranslation()
	const [code, setCode] = useState('')
	const [message, setMessage] = useState<{
		type: 'success' | 'error'
		text?: string
		key?: AppTranslationKey
		name?: string
	} | null>(null)
	const redeemCode = useRedeemInviteCode()

	const handleRedeem = async (e: FormEvent) => {
		e.preventDefault()
		setMessage(null)

		if (!code.trim()) {
			setMessage({ type: 'error', key: 'groups.inviteCode.required' })
			return
		}

		try {
			const result = await redeemCode.mutateAsync(code.trim())
			setMessage({
				type: 'success',
				key: 'groups.notifications.codeRedeemed',
				name: result.group.name,
			})
			setCode('')
			onSuccess?.()
			setTimeout(() => setMessage(null), 5000)
		} catch (error) {
			if (error instanceof Error) {
				setMessage({ type: 'error', text: error.message })
			} else {
				setMessage({ type: 'error', key: 'groups.inviteCode.failed' })
			}
			setTimeout(() => setMessage(null), 5000)
		}
	}

	return (
		<Card variant="default">
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<Ticket className="h-5 w-5" />
					{t('groups.inviteCode.title')}
				</CardTitle>
				<CardDescription>{t('groups.inviteCode.description')}</CardDescription>
			</CardHeader>
			<CardContent>
				<form onSubmit={handleRedeem} className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="invite-code">{t('groups.inviteCode.label')}</Label>
						<Input
							id="invite-code"
							value={code}
							onChange={(e) => setCode((e.target as HTMLInputElement).value)}
							placeholder={t('groups.inviteCode.placeholder')}
							disabled={redeemCode.isPending}
						/>
					</div>

					{message && (
						<div
							className={`rounded-md p-3 text-sm ${
								message.type === 'error'
									? 'bg-destructive/10 text-destructive border border-destructive'
									: 'bg-primary/10 text-primary border border-primary'
							}`}
						>
							{message.key ? t(message.key, { name: message.name }) : message.text}
						</div>
					)}

					<Button type="submit" disabled={redeemCode.isPending} className="w-full">
						{redeemCode.isPending
							? t('groups.inviteCode.redeeming')
							: t('groups.inviteCode.redeem')}
					</Button>
				</form>
			</CardContent>
		</Card>
	)
}

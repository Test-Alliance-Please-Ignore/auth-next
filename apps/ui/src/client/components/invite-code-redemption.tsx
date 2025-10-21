import { useState } from 'react'
import { Ticket } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useRedeemInviteCode } from '@/hooks/useGroups'

interface InviteCodeRedemptionProps {
	onSuccess?: (groupName: string) => void
}

export function InviteCodeRedemption({ onSuccess }: InviteCodeRedemptionProps) {
	const [code, setCode] = useState('')
	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
	const redeemCode = useRedeemInviteCode()

	const handleRedeem = async (e: React.FormEvent) => {
		e.preventDefault()
		setMessage(null)

		if (!code.trim()) {
			setMessage({ type: 'error', text: 'Please enter an invite code' })
			return
		}

		try {
			const result = await redeemCode.mutateAsync(code.trim())
			setMessage({ type: 'success', text: result.message })
			setCode('')
			onSuccess?.(result.group.name)
			setTimeout(() => setMessage(null), 5000)
		} catch (error) {
			if (error instanceof Error) {
				setMessage({ type: 'error', text: error.message })
			} else {
				setMessage({ type: 'error', text: 'Failed to redeem invite code' })
			}
			setTimeout(() => setMessage(null), 5000)
		}
	}

	return (
		<Card className="glow">
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<Ticket className="h-5 w-5" />
					Redeem Invite Code
				</CardTitle>
				<CardDescription>Enter an invite code to join a group</CardDescription>
			</CardHeader>
			<CardContent>
				<form onSubmit={handleRedeem} className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="invite-code">Invite Code</Label>
						<Input
							id="invite-code"
							value={code}
							onChange={(e) => setCode((e.target as HTMLInputElement).value)}
							placeholder="Enter invite code"
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
							{message.text}
						</div>
					)}

					<Button type="submit" disabled={redeemCode.isPending} className="w-full">
						{redeemCode.isPending ? 'Redeeming...' : 'Redeem Code'}
					</Button>
				</form>
			</CardContent>
		</Card>
	)
}

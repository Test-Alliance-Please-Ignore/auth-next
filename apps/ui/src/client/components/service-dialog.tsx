import { Copy, RefreshCw, Server } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'

import type { ResetServicePasswordResponse, UserService } from '@/lib/api'

interface ServiceDialogProps {
	service: UserService | null
	open: boolean
	onOpenChange: (open: boolean) => void
	onReset: (slug: string) => Promise<void>
	isResetting: boolean
	resetResult: ResetServicePasswordResponse | null
	resetError: Error | null
}

export function ServiceDialog({
	service,
	open,
	onOpenChange,
	onReset,
	isResetting,
	resetResult,
	resetError,
}: ServiceDialogProps) {
	const [copied, setCopied] = useState(false)

	if (!service) return null

	const handleReset = async () => {
		await onReset(service.service.slug)
	}

	const handleCopyPassword = async () => {
		if (resetResult?.newPassword) {
			await navigator.clipboard.writeText(resetResult.newPassword)
			setCopied(true)
			setTimeout(() => setCopied(false), 2000)
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						{service.service.icon ? (
							<img
								src={service.service.icon}
								alt=""
								className="w-6 h-6 rounded"
								onError={(e) => {
									;(e.currentTarget as HTMLImageElement).style.display = 'none'
								}}
							/>
						) : (
							<Server className="w-6 h-6" />
						)}
						{service.service.name}
					</DialogTitle>
					<DialogDescription>
						{service.service.description || 'Manage your service settings'}
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					{/* Service Status */}
					<div className="bg-muted/50 rounded-lg p-4">
						<p className="text-sm">
							<span className="text-muted-foreground">Status: </span>
							<span className={service.enabled ? 'text-green-500' : 'text-muted-foreground'}>
								{service.enabled ? 'Active' : 'Disabled'}
							</span>
						</p>
					</div>

					{/* Success Message */}
					{resetResult?.success && (
						<div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3">
							<p className="text-sm text-green-600 dark:text-green-400">{resetResult.message}</p>
							{resetResult.newPassword && (
								<div className="mt-2">
									<p className="text-xs text-muted-foreground mb-1">New Password:</p>
									<div className="flex items-center gap-2">
										<code className="flex-1 text-sm font-mono p-2 bg-muted rounded select-all">
											{resetResult.newPassword}
										</code>
										<Button variant="ghost" size="sm" onClick={handleCopyPassword}>
											<Copy className="h-4 w-4" />
											{copied ? 'Copied!' : 'Copy'}
										</Button>
									</div>
								</div>
							)}
						</div>
					)}

					{/* Error Message */}
					{resetError && (
						<div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
							<p className="text-sm text-destructive">
								{resetError.message || 'Failed to reset password. Please try again.'}
							</p>
						</div>
					)}

					{/* Reset Button */}
					<Button
						onClick={handleReset}
						disabled={isResetting || !service.enabled}
						variant="destructive"
						className="w-full"
					>
						<RefreshCw className={`h-4 w-4 ${isResetting ? 'animate-spin' : ''}`} />
						{isResetting ? 'Resetting Password...' : 'Reset Password'}
					</Button>

					{!service.enabled && (
						<p className="text-xs text-muted-foreground text-center">
							This service is currently disabled for your account.
						</p>
					)}
				</div>
			</DialogContent>
		</Dialog>
	)
}

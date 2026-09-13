import { useEffect, useState } from 'react'

import { useAppTranslation } from '@/i18n'

import { Button } from './button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from './dialog'
import { Input } from './input'
import { Label } from './label'

export type PasswordPromptDialogProps = {
	open: boolean
	title: string
	description: string
	confirmLabel?: string
	cancelLabel?: string
	pending?: boolean
	onCancel: () => void
	onConfirm: (password: string) => void
}

export function PasswordPromptDialog({
	open,
	title,
	description,
	confirmLabel,
	cancelLabel,
	pending = false,
	onCancel,
	onConfirm,
}: PasswordPromptDialogProps) {
	const { t } = useAppTranslation()
	const [value, setValue] = useState('')

	useEffect(() => {
		if (!open) setValue('')
	}, [open])

	return (
		<Dialog open={open} onOpenChange={(nextOpen) => (!nextOpen ? onCancel() : undefined)}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				<div className="space-y-2">
					<Label htmlFor="password-prompt-input">{t('common.password')}</Label>
					<Input
						id="password-prompt-input"
						type="password"
						autoComplete="current-password"
						value={value}
						onChange={(e) => setValue(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === 'Enter' && value.trim() && !pending) {
								onConfirm(value)
							}
						}}
					/>
				</div>
				<DialogFooter>
					<Button variant="cancel" showIcon={false} disabled={pending} onClick={onCancel}>
						{cancelLabel ?? t('common.cancel')}
					</Button>
					<Button
						variant="confirm"
						showIcon={false}
						disabled={pending || !value.trim()}
						loading={pending}
						onClick={() => onConfirm(value)}
					>
						{confirmLabel ?? t('common.confirm')}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}

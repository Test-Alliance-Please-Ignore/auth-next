import { useState } from 'react'
import { useNavigate } from 'react-router'

import { MAX_PERSONAL_BROADCAST_TEMPLATES } from '@repo/broadcasts'

import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
	usePersonalBroadcastTemplates,
	useSavePersonalBroadcastTemplate,
} from '@/hooks/useBroadcasts'
import { useAppTranslation } from '@/i18n'
import { BaseApiError } from '@/lib/api'

import type { PersonalBroadcastTemplate, PersonalBroadcastTemplateInput } from '@repo/broadcasts'

export function SavePersonalBroadcastTemplate({
	getValues,
	disabled,
	source,
	editOnly = false,
}: {
	getValues: () => Omit<PersonalBroadcastTemplateInput, 'name'>
	disabled: boolean
	source?: PersonalBroadcastTemplate
	editOnly?: boolean
}) {
	const { t } = useAppTranslation()
	const navigate = useNavigate()
	const templates = usePersonalBroadcastTemplates()
	const save = useSavePersonalBroadcastTemplate()
	const [open, setOpen] = useState(false)
	const [name, setName] = useState('')
	const [updateExisting, setUpdateExisting] = useState(false)
	const atLimit = (templates.data?.length ?? 0) >= MAX_PERSONAL_BROADCAST_TEMPLATES
	const unavailable = disabled || !templates.data || templates.isError || save.isPending
	const startSave = (update: boolean) => {
		setName(update ? (source?.name ?? '') : '')
		setUpdateExisting(update)
		save.reset()
		setOpen(true)
	}
	const submit = async () => {
		if (!name.trim() || unavailable || (!updateExisting && atLimit)) return
		try {
			await save.mutateAsync({
				id: updateExisting ? source?.id : undefined,
				data: { ...getValues(), name: name.trim() },
			})
			setOpen(false)
			await navigate('/broadcasts')
		} catch {
			// Keep the dialog and name available for retry; errors are localized below.
		}
	}
	return (
		<div className="space-y-2 rounded-md border border-border p-3">
			{!editOnly && (
				<p className="text-sm text-muted-foreground">
					{t('broadcasts.personal.help', { max: MAX_PERSONAL_BROADCAST_TEMPLATES })}
				</p>
			)}
			<div className="flex flex-wrap gap-2">
				{!editOnly && (
					<Button
						type="button"
						variant="secondary"
						size="sm"
						disabled={unavailable || atLimit}
						onClick={() => startSave(false)}
					>
						{t('broadcasts.personal.saveNew')}
					</Button>
				)}
				{source && (
					<Button
						type="button"
						variant="secondary"
						size="sm"
						disabled={unavailable}
						onClick={() => startSave(true)}
					>
						{t('broadcasts.personal.update')}
					</Button>
				)}
			</div>
			{atLimit && !editOnly && (
				<p className="text-sm text-muted-foreground">
					{t('broadcasts.personal.limit', { max: MAX_PERSONAL_BROADCAST_TEMPLATES })}
				</p>
			)}
			{templates.isError && (
				<p role="alert" className="text-sm text-destructive">
					{t('broadcasts.personal.loadFailed')}{' '}
					<Button type="button" variant="link" size="sm" onClick={() => void templates.refetch()}>
						{t('broadcasts.templates.retry')}
					</Button>
				</p>
			)}
			<Dialog
				open={open}
				onOpenChange={(value) => {
					if (!save.isPending) setOpen(value)
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							{t(updateExisting ? 'broadcasts.personal.update' : 'broadcasts.personal.saveNew')}
						</DialogTitle>
						<DialogDescription>{t('broadcasts.personal.saveDescription')}</DialogDescription>
					</DialogHeader>
					<div className="space-y-2">
						<Label htmlFor="personal-template-name">{t('broadcasts.personal.name')}</Label>
						<Input
							id="personal-template-name"
							value={name}
							maxLength={80}
							disabled={save.isPending}
							onChange={(event) => setName(event.target.value)}
						/>
					</div>
					{save.isError && (
						<p role="alert" className="text-sm text-destructive">
							{t(
								save.error instanceof BaseApiError && save.error.status === 409
									? 'broadcasts.personal.limit'
									: 'broadcasts.personal.saveFailed',
								{ max: MAX_PERSONAL_BROADCAST_TEMPLATES }
							)}
						</p>
					)}
					<DialogFooter>
						<Button
							type="button"
							variant="cancel"
							disabled={save.isPending}
							onClick={() => setOpen(false)}
						>
							{t('common.cancel')}
						</Button>
						<Button
							type="button"
							disabled={!name.trim() || unavailable}
							onClick={() => void submit()}
						>
							{t('broadcasts.personal.save')}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}

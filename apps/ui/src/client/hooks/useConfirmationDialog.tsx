import { useCallback, useEffect, useMemo, useState } from 'react'

import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { useAppTranslation } from '@/i18n'

import type { ButtonVariant } from '@/components/ui/button'
import type {
	ConfirmationDialogProps,
	ConfirmationIntent,
} from '@/components/ui/confirmation-dialog'
import type { AppTranslator } from '@/i18n'

// Resolve stored copy at render time so open confirmations follow locale changes.
type ConfirmationText = string | ((t: AppTranslator) => string)

function resolveText(value: ConfirmationText, t: AppTranslator): string {
	return typeof value === 'function' ? value(t) : value
}

type ConfirmationRequest = {
	title: ConfirmationText
	description: ConfirmationText
	confirmLabel: ConfirmationText
	cancelLabel?: ConfirmationText
	intent?: ConfirmationIntent
	confirmButtonVariant?: ButtonVariant
	cancelButtonVariant?: ButtonVariant
	confirmDelaySeconds?: number
	onConfirm: () => void | Promise<void>
}

type UseConfirmationDialogResult = {
	requestConfirmation: (request: ConfirmationRequest) => void
	closeConfirmation: () => void
	isOpen: boolean
	isPending: boolean
	confirmationDialog: ReturnType<typeof ConfirmationDialog> | null
}

export function useConfirmationDialog(): UseConfirmationDialogResult {
	const { t } = useAppTranslation()
	const [request, setRequest] = useState<ConfirmationRequest | null>(null)
	const [pending, setPending] = useState(false)
	const [nowMs, setNowMs] = useState(() => Date.now())
	const [requestedAtMs, setRequestedAtMs] = useState(() => Date.now())

	const closeConfirmation = useCallback(() => {
		if (pending) return
		setRequest(null)
	}, [pending])

	const requestConfirmation = useCallback((nextRequest: ConfirmationRequest) => {
		const startedAt = Date.now()
		setRequest(nextRequest)
		setRequestedAtMs(startedAt)
		setNowMs(startedAt)
	}, [])

	useEffect(() => {
		if (!request?.confirmDelaySeconds || request.confirmDelaySeconds <= 0 || pending) return
		const interval = setInterval(() => {
			setNowMs(Date.now())
		}, 200)
		return () => clearInterval(interval)
	}, [request, pending])

	const handleConfirm = useCallback(async () => {
		if (!request || pending) return

		setPending(true)
		try {
			await request.onConfirm()
			setRequest(null)
		} finally {
			setPending(false)
		}
	}, [request, pending])

	const confirmationDialog = useMemo(() => {
		if (!request) return null
		const confirmDelayMs = Math.max(0, (request.confirmDelaySeconds ?? 0) * 1000)
		const unlockAtMs = confirmDelayMs > 0 ? requestedAtMs + confirmDelayMs : nowMs
		const remainingMs = Math.max(0, unlockAtMs - nowMs)
		const remainingSeconds = Math.ceil(remainingMs / 1000)
		const confirmDelayActive = confirmDelayMs > 0 && remainingMs > 0
		const actionLabel = resolveText(request.confirmLabel, t)
		const confirmLabel = confirmDelayActive
			? t('common.confirmationCountdown', { label: actionLabel, count: remainingSeconds })
			: actionLabel

		const dialogProps: ConfirmationDialogProps = {
			open: true,
			title: resolveText(request.title, t),
			description: resolveText(request.description, t),
			confirmLabel,
			cancelLabel:
				request.cancelLabel === undefined ? undefined : resolveText(request.cancelLabel, t),
			intent: request.intent,
			confirmButtonVariant: request.confirmButtonVariant,
			cancelButtonVariant: request.cancelButtonVariant,
			confirmDisabled: confirmDelayActive,
			pending,
			onCancel: closeConfirmation,
			onConfirm: () => void handleConfirm(),
		}

		return <ConfirmationDialog {...dialogProps} />
	}, [request, pending, closeConfirmation, handleConfirm, nowMs, requestedAtMs, t])

	return {
		requestConfirmation,
		closeConfirmation,
		isOpen: Boolean(request),
		isPending: pending,
		confirmationDialog,
	}
}

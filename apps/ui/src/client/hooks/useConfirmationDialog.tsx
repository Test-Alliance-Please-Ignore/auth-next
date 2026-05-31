import { useCallback, useEffect, useMemo, useState } from 'react'

import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'

import type { ConfirmationDialogProps, ConfirmationIntent } from '@/components/ui/confirmation-dialog'
import type { ButtonVariant } from '@/components/ui/button'

type ConfirmationRequest = {
	title: string
	description: string
	confirmLabel: string
	cancelLabel?: string
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
		const confirmLabel = confirmDelayActive
			? `${request.confirmLabel} (${remainingSeconds}s)`
			: request.confirmLabel

		const dialogProps: ConfirmationDialogProps = {
			open: true,
			title: request.title,
			description: request.description,
			confirmLabel,
			cancelLabel: request.cancelLabel,
			intent: request.intent,
			confirmButtonVariant: request.confirmButtonVariant,
			cancelButtonVariant: request.cancelButtonVariant,
			confirmDisabled: confirmDelayActive,
			pending,
			onCancel: closeConfirmation,
			onConfirm: () => void handleConfirm(),
		}

		return <ConfirmationDialog {...dialogProps} />
	}, [request, pending, closeConfirmation, handleConfirm, nowMs, requestedAtMs])

	return {
		requestConfirmation,
		closeConfirmation,
		isOpen: Boolean(request),
		isPending: pending,
		confirmationDialog,
	}
}

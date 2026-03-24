import { useCallback, useMemo, useState } from 'react'

import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'

import type { ConfirmationDialogProps, ConfirmationIntent } from '@/components/ui/confirmation-dialog'

type ConfirmationRequest = {
	title: string
	description: string
	confirmLabel: string
	cancelLabel?: string
	intent?: ConfirmationIntent
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

	const closeConfirmation = useCallback(() => {
		if (pending) return
		setRequest(null)
	}, [pending])

	const requestConfirmation = useCallback((nextRequest: ConfirmationRequest) => {
		setRequest(nextRequest)
	}, [])

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

		const dialogProps: ConfirmationDialogProps = {
			open: true,
			title: request.title,
			description: request.description,
			confirmLabel: request.confirmLabel,
			cancelLabel: request.cancelLabel,
			intent: request.intent,
			pending,
			onCancel: closeConfirmation,
			onConfirm: () => void handleConfirm(),
		}

		return <ConfirmationDialog {...dialogProps} />
	}, [request, pending, closeConfirmation, handleConfirm])

	return {
		requestConfirmation,
		closeConfirmation,
		isOpen: Boolean(request),
		isPending: pending,
		confirmationDialog,
	}
}

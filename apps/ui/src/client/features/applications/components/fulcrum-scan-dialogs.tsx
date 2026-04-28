import { useState } from 'react'

import { Checkbox } from '@/components/ui/checkbox'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

const SCAN_ALL_SEND_DM_PREF_KEY = 'fulcrum:scan-all:send-dm'

export function useFulcrumScanDmPreference() {
	const [sendDmForScanRequests, setSendDmForScanRequests] = useState(() => {
		if (typeof window === 'undefined') return true
		const raw = window.localStorage.getItem(SCAN_ALL_SEND_DM_PREF_KEY)
		return raw === null ? true : raw === 'true'
	})

	const persist = (value: boolean) => {
		if (typeof window !== 'undefined') {
			window.localStorage.setItem(SCAN_ALL_SEND_DM_PREF_KEY, value ? 'true' : 'false')
		}
	}

	return {
		sendDmForScanRequests,
		setSendDmForScanRequests,
		persistSendDmPreference: persist,
	}
}

export function FulcrumBulkScanDialog({
	open,
	onOpenChange,
	eligibleCount,
	sendDmForScanRequests,
	setSendDmForScanRequests,
	onConfirm,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	eligibleCount: number
	sendDmForScanRequests: boolean
	setSendDmForScanRequests: (value: boolean) => void
	onConfirm: () => void
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[500px]">
				<DialogHeader>
					<DialogTitle>Generate Reports For All Eligible Characters?</DialogTitle>
					<DialogDescription>
						This will queue {eligibleCount} report{eligibleCount === 1 ? '' : 's'}.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-2">
					<label
						htmlFor="scan-all-send-dm"
						className="flex cursor-pointer items-center gap-2 rounded-md border p-3"
					>
						<Checkbox
							id="scan-all-send-dm"
							checked={sendDmForScanRequests}
							onCheckedChange={(checked) => setSendDmForScanRequests(checked === true)}
						/>
						<div>
							<span className="text-sm font-medium leading-none">Send DM for report status</span>
						</div>
					</label>
				</div>
				<DialogFooter>
					<Button variant="cancel" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button variant="confirm" onClick={onConfirm}>
						Generate Reports
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}

export function FulcrumSingleScanDialog({
	open,
	onOpenChange,
	characterName,
	sendDmForScanRequests,
	setSendDmForScanRequests,
	onConfirm,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	characterName: string
	sendDmForScanRequests: boolean
	setSendDmForScanRequests: (value: boolean) => void
	onConfirm: () => void
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[500px]">
				<DialogHeader>
					<DialogTitle>Generate Report For {characterName}?</DialogTitle>
					<DialogDescription>This will queue one character report.</DialogDescription>
				</DialogHeader>
				<div className="space-y-2">
					<label
						htmlFor="scan-single-send-dm"
						className="flex cursor-pointer items-center gap-2 rounded-md border p-3"
					>
						<Checkbox
							id="scan-single-send-dm"
							checked={sendDmForScanRequests}
							onCheckedChange={(checked) => setSendDmForScanRequests(checked === true)}
						/>
						<div>
							<span className="text-sm font-medium leading-none">Send DM for report status</span>
						</div>
					</label>
				</div>
				<DialogFooter>
					<Button variant="cancel" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button variant="confirm" onClick={onConfirm}>
						Generate Report
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}

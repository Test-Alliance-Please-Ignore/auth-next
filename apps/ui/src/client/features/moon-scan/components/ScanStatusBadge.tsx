import { Badge } from '@/components/ui/badge'

import type { MoonScanStatus } from '../types'

export function ScanStatusBadge({ status }: { status: MoonScanStatus }) {
	if (status === 'verified') {
		return <Badge className="border-green-500/30 bg-green-500/20 text-green-400">Verified</Badge>
	}
	if (status === 'rejected') {
		return <Badge className="border-red-500/30 bg-red-500/20 text-red-400">Rejected</Badge>
	}
	return <Badge className="border-yellow-500/30 bg-yellow-500/20 text-yellow-400">Pending</Badge>
}

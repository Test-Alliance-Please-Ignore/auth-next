import { CheckCircle2, CircleDot } from 'lucide-react'

import { Badge } from '@/components/ui/badge'

interface SessionStatusPillProps {
	status: 'active' | 'ended'
}

export function SessionStatusPill({ status }: SessionStatusPillProps) {
	if (status === 'active') {
		return <Badge variant="success" icon={CircleDot}>LIVE</Badge>
	}
	return <Badge variant="secondary" icon={CheckCircle2}>ENDED</Badge>
}

import { CheckCircle, AlertCircle, Clock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { DirectorHealth } from '@/lib/api'

interface DirectorStatusBadgeProps {
	director: DirectorHealth
	showFailureCount?: boolean
}

export function DirectorStatusBadge({ director, showFailureCount = true }: DirectorStatusBadgeProps) {
	const { isHealthy, failureCount, lastHealthCheck } = director

	// Never checked - needs verification
	if (!lastHealthCheck) {
		return (
			<Badge variant="outline" className="gap-1">
				<Clock className="h-3 w-3" />
				<span>Needs Verification</span>
			</Badge>
		)
	}

	// Healthy director
	if (isHealthy) {
		return (
			<Badge variant="default" className="gap-1 bg-green-600 hover:bg-green-700">
				<CheckCircle className="h-3 w-3" />
				<span>Healthy</span>
			</Badge>
		)
	}

	// Unhealthy director
	return (
		<Badge variant="destructive" className="gap-1">
			<AlertCircle className="h-3 w-3" />
			<span>Unhealthy</span>
			{showFailureCount && failureCount > 0 && (
				<span className="ml-1">({failureCount} failures)</span>
			)}
		</Badge>
	)
}

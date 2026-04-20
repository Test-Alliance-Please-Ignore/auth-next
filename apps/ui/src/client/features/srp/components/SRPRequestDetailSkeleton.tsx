import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

interface SRPRequestDetailSkeletonProps {
	mode?: 'request' | 'review'
}

export function SRPRequestDetailSkeleton({ mode = 'request' }: SRPRequestDetailSkeletonProps) {
	return (
		<div className="space-y-6">
			<div className="space-y-2">
				<Skeleton className="h-8 w-72" />
				<Skeleton className="h-5 w-96 max-w-full" />
			</div>

			<div className="mb-6 flex items-center gap-3">
				<Skeleton className="h-6 w-28" />
				<Skeleton className="h-5 w-24" />
			</div>

			{mode === 'review' ? (
				<div className="grid gap-6 lg:grid-cols-2">
					<div className="space-y-4">
						<Card className="p-4">
							<Skeleton className="h-[398px] w-[398px] max-w-full mx-auto" />
						</Card>
						<Card className="p-4 space-y-2">
							<Skeleton className="h-5 w-24" />
							{Array.from({ length: 8 }, (_, i) => (
								<Skeleton key={i} className="h-10 w-full" />
							))}
						</Card>
					</div>
					<div className="space-y-4">
						{Array.from({ length: 4 }, (_, i) => (
							<Card key={i} className="p-4 space-y-3">
								<Skeleton className="h-5 w-40" />
								{Array.from({ length: 4 }, (_, j) => (
									<Skeleton key={j} className="h-9 w-full" />
								))}
							</Card>
						))}
					</div>
				</div>
			) : (
				<div className="grid gap-6 lg:grid-cols-3">
					<div className="space-y-6 lg:col-span-2">
						<Card className="p-6 space-y-4">
							<Skeleton className="h-6 w-32" />
							<div className="grid gap-4 sm:grid-cols-2">
								{Array.from({ length: 6 }, (_, i) => (
									<Skeleton key={i} className="h-12 w-full" />
								))}
							</div>
						</Card>
						<Card className="p-6 space-y-4">
							<Skeleton className="h-6 w-28" />
							{Array.from({ length: 4 }, (_, i) => (
								<Skeleton key={i} className="h-12 w-full" />
							))}
						</Card>
					</div>
					<div className="space-y-6">
						<Card className="p-6 space-y-3">
							<Skeleton className="h-6 w-24" />
							{Array.from({ length: 3 }, (_, i) => (
								<Skeleton key={i} className="h-10 w-full" />
							))}
						</Card>
						<Card className="p-6 space-y-3">
							<Skeleton className="h-6 w-24" />
							<Skeleton className="h-10 w-full" />
						</Card>
					</div>
				</div>
			)}
		</div>
	)
}

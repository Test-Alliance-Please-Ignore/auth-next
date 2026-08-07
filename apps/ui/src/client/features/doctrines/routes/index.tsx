/**
 * Doctrines Landing Page
 *
 * Staging-system matrix: columns = staging systems, rows = doctrines grouped by category.
 */

import { Plus, Settings, Ship } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { LoadingSpinner } from '@/components/ui/loading'
import { PageHeader } from '@/components/ui/page-header'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import { typeIconUrl } from '@/lib/eve-images'

import { useDoctrines, useStagingSystems } from '../hooks'

import type { Doctrine, StagingSystem } from '../types'

/** Group doctrines by category, uncategorized last */
function groupByCategory(
	doctrines: Doctrine[]
): Array<{ categoryId: string; categoryName: string; doctrines: Doctrine[] }> {
	const map = new Map<
		string,
		{ categoryName: string; categorySortOrder: number; doctrines: Doctrine[] }
	>()
	for (const d of doctrines) {
		const key = d.categoryId || '__uncategorized__'
		const existing = map.get(key)
		if (existing) {
			existing.doctrines.push(d)
		} else {
			map.set(key, {
				categoryName:
					key === '__uncategorized__' ? 'Uncategorized' : d.categoryName || 'Unknown Category',
				categorySortOrder: d.categorySortOrder ?? Number.MAX_SAFE_INTEGER,
				doctrines: [d],
			})
		}
	}
	return Array.from(map.entries())
		.map(([categoryId, v]) => ({
			categoryId,
			categoryName: v.categoryName,
			doctrines: v.doctrines.sort((a, b) => a.sortOrder - b.sortOrder),
			categorySortOrder: v.categorySortOrder,
		}))
		.sort((a, b) => {
			if (a.categoryId === '__uncategorized__') return 1
			if (b.categoryId === '__uncategorized__') return -1
			return a.categorySortOrder - b.categorySortOrder
		})
}

/** Look up the note for a doctrine × staging-system pair */
function getStagingNote(doctrine: Doctrine, stagingSystemId: string): string | null {
	const entry = doctrine.stagingSystems?.find((s) => s.stagingSystem.id === stagingSystemId)
	return entry ? entry.note : null
}

export default function DoctrinesPage() {
	usePageTitle('Doctrines')
	const { hasPermission, isAdmin } = useUserPermissions()
	const { data: doctrines, isLoading, error } = useDoctrines()
	const { data: stagingSystems } = useStagingSystems()

	const canManage = isAdmin || hasPermission('urn:doctrines:manager')

	const sortedStagingSystems = useMemo(
		() => [...(stagingSystems || [])].sort((a, b) => a.sortOrder - b.sortOrder),
		[stagingSystems]
	)

	const categories = useMemo(() => {
		if (!doctrines) return []
		return groupByCategory(doctrines)
	}, [doctrines])

	const totalCols = sortedStagingSystems.length + 1

	if (isLoading) {
		return (
			<Container>
				<PageHeader title="Doctrines" description="Browse fleet doctrines" />
				<Card>
					<CardContent className="pt-6">
						<LoadingSpinner />
					</CardContent>
				</Card>
			</Container>
		)
	}

	if (error) {
		return (
			<Container>
				<PageHeader title="Doctrines" description="Browse fleet doctrines" />
				<Card>
					<CardContent className="pt-6">
						<div className="text-center text-destructive">
							Failed to load doctrines. Please try again later.
						</div>
					</CardContent>
				</Card>
			</Container>
		)
	}

	return (
		<Container>
			<PageHeader
				title="Doctrines"
				description="TEST Alliance Please Ignore fleet doctrines"
				action={
					canManage && (
						<div className="flex gap-2">
							<Button asChild variant="ghost">
								<Link to="/doctrines/admin">
									<Settings className="h-4 w-4" />
									Admin
								</Link>
							</Button>
							<Button asChild variant="secondary">
								<Link to="/doctrines/fittings/create">
									<Plus className="h-4 w-4" />
									New Fitting
								</Link>
							</Button>
							<Button asChild>
								<Link to="/doctrines/create">
									<Plus className="h-4 w-4" />
									New Doctrine
								</Link>
							</Button>
						</div>
					)
				}
			/>

			<Card>
				<CardContent className="pt-6">
					{!doctrines || doctrines.length === 0 ? (
						<div className="text-center py-12">
							<p className="text-muted-foreground mb-4">No doctrines found.</p>
							{canManage && (
								<Button asChild>
									<Link to="/doctrines/create">
										<Plus className="h-4 w-4" />
										Create First Doctrine
									</Link>
								</Button>
							)}
						</div>
					) : (
						<div className="rounded-md border">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead className="min-w-[200px] text-xs font-semibold">Doctrine</TableHead>
										{sortedStagingSystems.map((ss) => (
											<TableHead
												key={ss.id}
												className="text-center whitespace-nowrap text-xs font-semibold"
											>
												{ss.solarSystemName}
											</TableHead>
										))}
									</TableRow>
								</TableHeader>
								<TableBody>
									{categories.map((cat) => (
										<CategoryRows
											key={cat.categoryId}
											categoryName={cat.categoryName}
											doctrines={cat.doctrines}
											stagingSystems={sortedStagingSystems}
											totalCols={totalCols}
											showCategoryHeader={categories.length > 1}
										/>
									))}
								</TableBody>
							</Table>
						</div>
					)}
				</CardContent>
			</Card>
		</Container>
	)
}

function CategoryRows({
	categoryName,
	doctrines,
	stagingSystems,
	totalCols,
	showCategoryHeader,
}: {
	categoryName: string
	doctrines: Doctrine[]
	stagingSystems: StagingSystem[]
	totalCols: number
	showCategoryHeader: boolean
}) {
	return (
		<>
			{showCategoryHeader && (
				<TableRow className="bg-muted/30 hover:bg-muted/30">
					<TableCell
						colSpan={totalCols}
						className="py-2 font-semibold uppercase tracking-wide text-xs text-muted-foreground"
					>
						{categoryName}
					</TableCell>
				</TableRow>
			)}
			{doctrines.map((doctrine) => (
				<TableRow key={doctrine.id}>
					<TableCell className="py-2">
						<Link
							to={`/doctrines/${doctrine.id}`}
							className="flex items-center gap-2.5 font-medium text-primary hover:underline"
						>
							<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-primary/10">
								{doctrine.shipTypeId ? (
									<img
										src={typeIconUrl(doctrine.shipTypeId, 64)}
										alt=""
										className="h-8 w-8 rounded"
									/>
								) : (
									<Ship className="h-4 w-4 text-primary" />
								)}
							</div>
							{doctrine.name}
						</Link>
					</TableCell>
					{stagingSystems.map((ss) => {
						const note = getStagingNote(doctrine, ss.id)
						return (
							<TableCell key={ss.id} className="text-center text-sm py-2">
								{note || ''}
							</TableCell>
						)
					})}
				</TableRow>
			))}
		</>
	)
}

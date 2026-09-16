/**
 * Fitting Detail Page
 *
 * EVE-style circular fitting display with info sidebar and slot list.
 */

import { ArrowLeft, CheckCircle2, ClipboardCopy, Edit, Gamepad2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { LoadingSpinner } from '@/components/ui/loading'
import { PageHeader } from '@/components/ui/page-header'
import { Select } from '@/components/ui/select'
import { useAuth } from '@/hooks/useAuth'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import { useAppTranslation } from '@/i18n'
import toast from '@/lib/toast'

import { FittingPanel } from '../components/FittingPanel'
import { FittingSlotList } from '../components/FittingSlotList'
import { useFitting, useSaveFittingIngame } from '../hooks'

export default function FittingDetailPage() {
	const { t } = useAppTranslation()

	const { id } = useParams<{ id: string }>()
	const [searchParams] = useSearchParams()
	const doctrineId = searchParams.get('doctrineId')
	const { user } = useAuth()
	const { hasPermission, isAdmin } = useUserPermissions()
	const { data: fitting, isLoading, error } = useFitting(id)
	const saveMutation = useSaveFittingIngame()
	const [copied, setCopied] = useState(false)
	const [selectedCharacterId, setSelectedCharacterId] = useState(user?.mainCharacterId ?? '')

	usePageTitle(fitting ? `${fitting.shipName} Fitting` : t('doctrines.fittingDetails'))

	const canManage = isAdmin || hasPermission('urn:doctrines:manager')

	const validTokenChars = user?.characters.filter((ch) => ch.hasValidToken) ?? []

	const handleCopyEft = async () => {
		if (!fitting) return
		await navigator.clipboard.writeText(fitting.fitting)
		setCopied(true)
		toast.success(t('doctrines.eftCopiedToClipboard'))
		setTimeout(() => setCopied(false), 2000)
	}

	const handleSaveIngame = async () => {
		if (!id || !selectedCharacterId) return
		try {
			await saveMutation.mutateAsync({ fittingId: id, characterId: selectedCharacterId })
			toast.success(t('doctrines.fittingSavedInGame'))
		} catch (err) {
			toast.error(err instanceof Error ? err.message : t('doctrines.failedToSaveFittingInGame'))
		}
	}

	if (isLoading) {
		return (
			<Container>
				<LoadingSpinner />
			</Container>
		)
	}

	if (error || !fitting) {
		return (
			<Container>
				<PageHeader title={t('doctrines.fittingNotFound')} />
				<Card>
					<CardContent className="pt-6">
						<div className="text-center">
							<p className="text-muted-foreground mb-4">
								{t('doctrines.theFittingYouReLookingForDoesnTExistOr')}
							</p>
							<Button asChild variant="ghost">
								<Link to="/doctrines">
									<ArrowLeft className="h-4 w-4" />
									{t('doctrines.backToDoctrines')}
								</Link>
							</Button>
						</div>
					</CardContent>
				</Card>
			</Container>
		)
	}

	return (
		<Container>
			<Button asChild variant="ghost" size="sm" className="mb-4">
				<Link to={doctrineId ? `/doctrines/${doctrineId}` : '/doctrines'}>
					<ArrowLeft className="h-4 w-4" />
					{doctrineId ? t('doctrines.backToDoctrine') : t('doctrines.backToDoctrines')}
				</Link>
			</Button>

			<PageHeader
				title={fitting.name}
				description={fitting.shipName}
				action={
					canManage && (
						<Button asChild variant="ghost">
							<Link
								to={`/doctrines/fittings/${id}/edit${doctrineId ? `?doctrineId=${doctrineId}` : ''}`}
							>
								<Edit className="h-4 w-4" />
								{t('doctrines.edit')}
							</Link>
						</Button>
					)
				}
			/>

			{/* Top row: Info left, Circular panel right */}
			<div className="grid gap-6 lg:grid-cols-2 mb-6">
				{/* Left — Fitting Information */}
				<Card>
					<CardContent className="pt-6 space-y-4">
						<div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-sm">
							<span className="text-muted-foreground">{t('doctrines.name')}</span>
							<span className="font-medium">{fitting.name}</span>

							<span className="text-muted-foreground">{t('doctrines.ship')}</span>
							<span>{fitting.shipName}</span>

							<span className="text-muted-foreground">{t('doctrines.category')}</span>
							<span>{fitting.category}</span>

							<span className="text-muted-foreground">SRP</span>
							<span>
								{fitting.srpEligible ? (
									<Badge variant="default" className="inline-flex items-center gap-1">
										<CheckCircle2 className="h-3 w-3" />
										{t('doctrines.srpEligible')}
									</Badge>
								) : (
									<span className="text-muted-foreground">{t('doctrines.notEligible')}</span>
								)}
							</span>
						</div>

						{fitting.description && (
							<div className="pt-2 border-t">
								<p className="text-sm text-muted-foreground mb-1">{t('doctrines.description')}</p>
								<p className="text-sm whitespace-pre-wrap">{fitting.description}</p>
							</div>
						)}

						<div className="pt-2 space-y-2">
							<div>
								<Button variant="ghost" size="sm" onClick={handleCopyEft}>
									<ClipboardCopy className="h-4 w-4" />
									{copied ? t('doctrines.copied') : t('doctrines.copyEft')}
								</Button>
							</div>
							{validTokenChars.length > 0 && (
								<div className="flex items-center gap-2">
									{validTokenChars.length > 1 && (
										<Select
											options={validTokenChars.map((ch) => ({
												value: ch.characterId,
												label: ch.characterName,
											}))}
											value={selectedCharacterId}
											onValueChange={setSelectedCharacterId}
											placeholder={t('doctrines.character')}
										/>
									)}
									<Button
										variant="ghost"
										size="sm"
										onClick={handleSaveIngame}
										disabled={!selectedCharacterId}
										loading={saveMutation.isPending}
										loadingText={t('doctrines.saving')}
									>
										<Gamepad2 className="h-4 w-4" />
										{t('doctrines.saveInGame')}
									</Button>
								</div>
							)}
						</div>
					</CardContent>
				</Card>

				{/* Right — Circular Fitting Panel */}
				<Card>
					<CardContent className="pt-6 flex items-center justify-center">
						<FittingPanel
							fittingItems={fitting.fittingItems}
							shipTypeId={fitting.shipTypeId}
							shipName={fitting.shipName}
						/>
					</CardContent>
				</Card>
			</div>

			{/* Bottom — Slot List (full width) */}
			<Card>
				<CardContent className="pt-6">
					<h3 className="text-sm font-semibold mb-3">{t('doctrines.fittingDetails')}</h3>
					<FittingSlotList fittingItems={fitting.fittingItems} />
				</CardContent>
			</Card>
		</Container>
	)
}

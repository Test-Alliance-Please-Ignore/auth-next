import { useEffect, useState } from 'react'

import { useAddGroupMember, useCreateInvitation, useSearchCharacters } from '@/hooks/useGroups'
import { useAppTranslation } from '@/i18n'

import { Button } from './ui/button'
import { Card } from './ui/card'
import { Select } from './ui/select'

import type { FormEvent } from 'react'
import type { GroupWithDetails } from '@/lib/api'

interface InviteMemberFormProps {
	group: GroupWithDetails
	allowDirectAdd?: boolean
	onSuccess?: () => void
}

export function InviteMemberForm({
	group,
	allowDirectAdd = false,
	onSuccess,
}: InviteMemberFormProps) {
	const { t } = useAppTranslation()
	const isAdminManaged = group.joinMode === 'admin_managed'
	const [searchQuery, setSearchQuery] = useState('')
	const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('')
	const [selectedCharacter, setSelectedCharacter] = useState<string>('')
	const [errorMessage, setErrorMessage] = useState<Error | 'required' | 'failed' | null>(null)
	const [successMessage, setSuccessMessage] = useState<{
		action: 'added' | 'invited'
		name: string
	} | null>(null)

	const { data: searchResults, isLoading: isSearching } = useSearchCharacters(debouncedSearchQuery)
	const createInvitation = useCreateInvitation()
	const addGroupMember = useAddGroupMember()

	// Debounce search query - only update after 400ms of no typing
	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedSearchQuery(searchQuery)
		}, 400)

		return () => clearTimeout(timer)
	}, [searchQuery])

	const handleSelectCharacter = (characterName: string) => {
		setSearchQuery(characterName)
		setSelectedCharacter(characterName)
		setErrorMessage(null)
	}

	const handleSearchValueChange = (value: string) => {
		setSearchQuery(value)
		setSelectedCharacter('')
		setErrorMessage(null)
		setSuccessMessage(null)
	}

	if (isAdminManaged && !allowDirectAdd) {
		return (
			<Card className="p-4 border-dashed">
				<h3 className="text-lg font-semibold mb-2">{t('groupDetail.inviteMember.adminManaged')}</h3>
				<p className="text-sm text-muted-foreground">
					{t('groupDetail.inviteMember.adminManagedDescription')}
				</p>
			</Card>
		)
	}

	const handleSubmit = async (e: FormEvent) => {
		e.preventDefault()
		setErrorMessage(null)
		setSuccessMessage(null)

		const characterName = selectedCharacter || searchQuery.trim()

		if (!characterName) {
			setErrorMessage('required')
			return
		}

		try {
			if (isAdminManaged) {
				await addGroupMember.mutateAsync({
					groupId: group.id,
					characterName,
				})
				setSuccessMessage({ action: 'added', name: characterName })
			} else {
				await createInvitation.mutateAsync({
					groupId: group.id,
					characterName,
				})
				setSuccessMessage({ action: 'invited', name: characterName })
			}
			setSearchQuery('')
			setSelectedCharacter('')
			onSuccess?.()

			// Clear success message after 3 seconds
			setTimeout(() => setSuccessMessage(null), 3000)
		} catch (error) {
			setErrorMessage(error instanceof Error ? error : 'failed')
		}
	}

	return (
		<Card className="p-4">
			<h3 className="text-lg font-semibold mb-3">
				{isAdminManaged
					? t('groupDetail.inviteMember.addUser')
					: t('groupDetail.inviteMember.inviteMember')}
			</h3>

			<form onSubmit={handleSubmit} className="space-y-3">
				<div className="flex gap-2">
					<Select
						className="flex-1"
						value={selectedCharacter}
						onValueChange={(nextValue, option) => {
							if (!option) {
								return
							}
							handleSelectCharacter(option.label)
							setSelectedCharacter(nextValue)
						}}
						query={searchQuery}
						onQueryChange={handleSearchValueChange}
						searchable
						searchDelegate={() =>
							(searchResults || []).map((character) => ({
								value: character.characterName,
								label: character.characterName,
							}))
						}
						options={(searchResults || []).map((character) => ({
							value: character.characterName,
							label: character.characterName,
						}))}
						minQueryLength={2}
						debounceMs={0}
						placeholder={t('groupDetail.inviteMember.placeholder')}
						loading={
							searchQuery.length >= 2 && (isSearching || searchQuery !== debouncedSearchQuery)
						}
						queryHintText={t('common.typeAtLeast', { count: 2 })}
						loadingText={t('common.searching')}
						emptyText={t('groupDetail.inviteMember.noCharacters')}
					/>
					<Button
						type="submit"
						disabled={
							(isAdminManaged ? addGroupMember.isPending : createInvitation.isPending) ||
							!searchQuery.trim()
						}
					>
						{isAdminManaged
							? addGroupMember.isPending
								? t('groupDetail.inviteMember.adding')
								: t('groupDetail.inviteMember.addUser')
							: createInvitation.isPending
								? t('groupDetail.inviteMember.sending')
								: t('groupDetail.inviteMember.invite')}
					</Button>
				</div>

				{errorMessage && (
					<div className="text-sm text-destructive-foreground bg-destructive/10 border border-destructive/30 rounded px-3 py-2">
						{errorMessage instanceof Error
							? errorMessage.message
							: t(
									errorMessage === 'required'
										? 'groupDetail.inviteMember.characterRequired'
										: 'groupDetail.inviteMember.failed'
								)}
					</div>
				)}

				{successMessage && (
					<div className="text-sm text-foreground bg-primary/10 border border-primary/30 rounded px-3 py-2">
						{t(`groupDetail.inviteMember.${successMessage.action}`, { name: successMessage.name })}
					</div>
				)}

				<p className="text-xs text-muted-foreground">
					{isAdminManaged
						? t('groupDetail.inviteMember.directHint')
						: t('groupDetail.inviteMember.inviteHint')}
				</p>
			</form>
		</Card>
	)
}

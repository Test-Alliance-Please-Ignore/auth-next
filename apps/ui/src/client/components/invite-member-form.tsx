import { useEffect, useState } from 'react'

import { useAddGroupMember, useCreateInvitation, useSearchCharacters } from '@/hooks/useGroups'

import { Button } from './ui/button'
import { Card } from './ui/card'
import { Select } from './ui/select'

import type { GroupWithDetails } from '@/lib/api'

interface InviteMemberFormProps {
	group: GroupWithDetails
	allowDirectAdd?: boolean
	onSuccess?: () => void
}

export function InviteMemberForm({ group, allowDirectAdd = false, onSuccess }: InviteMemberFormProps) {
	const isAdminManaged = group.joinMode === 'admin_managed'
	const [searchQuery, setSearchQuery] = useState('')
	const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('')
	const [selectedCharacter, setSelectedCharacter] = useState<string>('')
	const [errorMessage, setErrorMessage] = useState<string | null>(null)
	const [successMessage, setSuccessMessage] = useState<string | null>(null)

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
				<h3 className="text-lg font-semibold mb-2">Admin Managed Group</h3>
				<p className="text-sm text-muted-foreground">
					This group is admin managed. Members can only be added by site admins.
				</p>
			</Card>
		)
	}

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()
		setErrorMessage(null)
		setSuccessMessage(null)

		const characterName = selectedCharacter || searchQuery.trim()

		if (!characterName) {
			setErrorMessage('Please enter a character name')
			return
		}

		try {
			if (isAdminManaged) {
				await addGroupMember.mutateAsync({
					groupId: group.id,
					characterName,
				})
				setSuccessMessage(`Member added directly: ${characterName}`)
			} else {
				await createInvitation.mutateAsync({
					groupId: group.id,
					characterName,
				})
				setSuccessMessage(`Invitation sent to ${characterName}`)
			}
			setSearchQuery('')
			setSelectedCharacter('')
			onSuccess?.()

			// Clear success message after 3 seconds
			setTimeout(() => setSuccessMessage(null), 3000)
		} catch (error: any) {
			setErrorMessage(error?.message || 'Failed to send invitation')
		}
	}

	return (
		<Card className="p-4">
			<h3 className="text-lg font-semibold mb-3">{isAdminManaged ? 'Add User' : 'Invite Member'}</h3>

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
						placeholder="Enter main character name..."
						loading={
							searchQuery.length >= 2 && (isSearching || searchQuery !== debouncedSearchQuery)
						}
						queryHintText="Type at least 2 characters"
						loadingText="Searching..."
						emptyText="No characters found"
					/>
					<Button
						type="submit"
						disabled={(isAdminManaged ? addGroupMember.isPending : createInvitation.isPending) || !searchQuery.trim()}
					>
						{isAdminManaged
							? addGroupMember.isPending
								? 'Adding...'
								: 'Add User'
							: createInvitation.isPending
								? 'Sending...'
								: 'Invite'}
					</Button>
				</div>

				{errorMessage && (
					<div className="text-sm text-destructive-foreground bg-destructive/10 border border-destructive/30 rounded px-3 py-2">
						{errorMessage}
					</div>
				)}

				{successMessage && (
					<div className="text-sm text-foreground bg-primary/10 border border-primary/30 rounded px-3 py-2">
						{successMessage}
					</div>
				)}

				<p className="text-xs text-muted-foreground">
					Start typing to search for characters. Only main characters can be{' '}
					{isAdminManaged ? 'added directly' : 'invited'}.
				</p>
			</form>
		</Card>
	)
}

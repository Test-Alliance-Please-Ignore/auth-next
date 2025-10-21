import { useState, useEffect, useRef } from 'react'
import { useCreateInvitation, useSearchCharacters } from '@/hooks/useGroups'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Card } from './ui/card'
import type { CharacterSearchResult } from '@/lib/api'

interface InviteMemberFormProps {
	groupId: string
	onSuccess?: () => void
}

export function InviteMemberForm({ groupId, onSuccess }: InviteMemberFormProps) {
	const [searchQuery, setSearchQuery] = useState('')
	const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('')
	const [selectedCharacter, setSelectedCharacter] = useState<string>('')
	const [showDropdown, setShowDropdown] = useState(false)
	const [errorMessage, setErrorMessage] = useState<string | null>(null)
	const [successMessage, setSuccessMessage] = useState<string | null>(null)
	const dropdownRef = useRef<HTMLDivElement>(null)

	const { data: searchResults, isLoading: isSearching } = useSearchCharacters(debouncedSearchQuery)
	const createInvitation = useCreateInvitation()

	// Debounce search query - only update after 400ms of no typing
	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedSearchQuery(searchQuery)
		}, 400)

		return () => clearTimeout(timer)
	}, [searchQuery])

	// Close dropdown when clicking outside
	useEffect(() => {
		function handleClickOutside(event: MouseEvent) {
			if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
				setShowDropdown(false)
			}
		}

		document.addEventListener('mousedown', handleClickOutside)
		return () => document.removeEventListener('mousedown', handleClickOutside)
	}, [])

	// Show dropdown when there are results
	useEffect(() => {
		if (searchResults && searchResults.length > 0 && debouncedSearchQuery.length >= 2) {
			setShowDropdown(true)
		} else {
			setShowDropdown(false)
		}
	}, [searchResults, debouncedSearchQuery])

	const handleSelectCharacter = (character: CharacterSearchResult) => {
		setSearchQuery(character.characterName)
		setSelectedCharacter(character.characterName)
		setShowDropdown(false)
		setErrorMessage(null)
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
			await createInvitation.mutateAsync({
				groupId,
				characterName,
			})

			setSuccessMessage(`Invitation sent to ${characterName}`)
			setSearchQuery('')
			setSelectedCharacter('')
			onSuccess?.()

			// Clear success message after 3 seconds
			setTimeout(() => setSuccessMessage(null), 3000)
		} catch (error: any) {
			setErrorMessage(error?.message || 'Failed to send invitation')
		}
	}

	const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const value = (e.target as HTMLInputElement).value
		setSearchQuery(value)
		setSelectedCharacter('')
		setErrorMessage(null)
		setSuccessMessage(null)
	}

	return (
		<Card className="p-4">
			<h3 className="text-lg font-semibold mb-3">Invite Member</h3>

			<form onSubmit={handleSubmit} className="space-y-3">
				<div className="relative" ref={dropdownRef}>
					<div className="flex gap-2">
						<div className="flex-1 relative">
							<Input
								type="text"
								placeholder="Enter main character name..."
								value={searchQuery}
								onChange={handleInputChange}
								className="w-full"
								autoComplete="off"
							/>
							{searchQuery.length >= 2 && (isSearching || searchQuery !== debouncedSearchQuery) && (
								<div className="absolute right-3 top-1/2 -translate-y-1/2">
									<div className="animate-spin h-4 w-4 border-2 border-border border-t-primary rounded-full"></div>
								</div>
							)}
						</div>
						<Button type="submit" disabled={createInvitation.isPending || !searchQuery.trim()}>
							{createInvitation.isPending ? 'Sending...' : 'Invite'}
						</Button>
					</div>

					{/* Autocomplete dropdown */}
					{showDropdown && searchResults && searchResults.length > 0 && (
						<div
						className="absolute z-50 w-full mt-1 border border-border rounded-md shadow-lg max-h-60 overflow-auto backdrop-blur-sm"
						style={{
							backgroundColor: 'hsl(0 0% 16%)',
							boxShadow: '0 0 20px rgba(0, 0, 0, 0.8), 0 4px 12px rgba(0, 0, 0, 0.5)',
						}}
					>
							{searchResults.map((character) => (
								<button
									key={character.characterId}
									type="button"
									className="w-full text-left px-4 py-2 text-popover-foreground hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none transition-colors rounded-sm"
									onClick={() => handleSelectCharacter(character)}
								>
									<div className="font-medium">{character.characterName}</div>
								</button>
							))}
						</div>
					)}
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
					Start typing to search for characters. Only main characters can be invited.
				</p>
			</form>
		</Card>
	)
}

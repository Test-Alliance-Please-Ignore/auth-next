import { Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useAdminUsers } from '@/hooks/useAdminUsers'
import { cn } from '@/lib/utils'

interface UserSearchDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
}

export function UserSearchDialog({ open, onOpenChange }: UserSearchDialogProps) {
	const navigate = useNavigate()
	const [searchQuery, setSearchQuery] = useState('')
	const [debouncedQuery, setDebouncedQuery] = useState('')

	// Debounce search query
	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedQuery(searchQuery)
		}, 300)

		return () => clearTimeout(timer)
	}, [searchQuery])

	const { data, isLoading } = useAdminUsers({
		search: debouncedQuery,
		pageSize: 10,
	})

	const users = data?.data || []

	const handleUserSelect = (userId: string) => {
		navigate(`/admin/users/${userId}`)
		onOpenChange(false)
		setSearchQuery('')
	}

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter' && users.length > 0) {
			handleUserSelect(users[0].id)
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle>Search Users</DialogTitle>
					<DialogDescription>
						Search by character name/ID, app user ID, Discord user ID, or Discord username
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					<div className="relative">
						<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
						<Input
							placeholder="Type character/user/discord identity..."
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							onKeyDown={handleKeyDown}
							className="pl-9"
							autoFocus
						/>
					</div>

					{/* Results */}
					<div className="space-y-2 max-h-[400px] overflow-y-auto">
						{isLoading && debouncedQuery && (
							<div className="text-sm text-muted-foreground text-center py-4">Searching...</div>
						)}

						{!isLoading && debouncedQuery && users.length === 0 && (
							<div className="text-sm text-muted-foreground text-center py-4">No users found</div>
						)}

						{!debouncedQuery && (
							<div className="text-sm text-muted-foreground text-center py-4">
								Start typing to search for users
							</div>
						)}

						{users.map((user) => (
							<button
								key={user.id}
								onClick={() => handleUserSelect(user.id)}
								className={cn(
									'w-full flex items-center gap-3 p-3 rounded-md border border-border',
									'hover:bg-accent/50 transition-colors text-left'
								)}
							>
								{(() => {
									const isAltMatch =
										!!user.matchedCharacterId &&
										user.matchedCharacterId !== user.mainCharacterId &&
										!!user.matchedCharacterName
									const portraitCharacterId = user.matchedCharacterId || user.mainCharacterId
									const displayName = isAltMatch
										? `${user.matchedCharacterName}${user.mainCharacterName ? ` (${user.mainCharacterName})` : ''}`
										: user.mainCharacterName || user.matchedCharacterName || 'Unknown Character'

									return (
										<>
											<img
												src={`/images/characters/${portraitCharacterId}/portrait?size=64`}
												alt={displayName}
												className="h-10 w-10 rounded-full"
											/>
											<div className="flex-1 min-w-0">
												<div className="inline-flex items-center gap-2 font-medium">
													{displayName}
													{isAltMatch && (
														<span className="text-xs bg-blue-500/20 text-blue-500 px-2 py-0.5 rounded">
															Alt
														</span>
													)}
												</div>
												<div className="text-sm text-muted-foreground">
													{user.characterCount} character{user.characterCount !== 1 ? 's' : ''}
												</div>
											</div>
										</>
									)
								})()}
								{user.is_admin && (
									<div className="text-xs bg-primary/20 text-primary px-2 py-1 rounded">Admin</div>
								)}
							</button>
						))}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	)
}

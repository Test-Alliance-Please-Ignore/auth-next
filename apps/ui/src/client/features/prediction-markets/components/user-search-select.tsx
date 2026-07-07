import { useCallback } from 'react'

import { Select } from '@/components/ui/select'
import { api } from '@/lib/api'
import { characterPortraitUrl } from '@/lib/eve-images'

import type { SelectOption } from '@/components/ui/select'
import type { AdminUser } from '@/lib/api'

export type UserOption = SelectOption & {
	mainCharacterId: string | null
	discordUsername: string | null
}

export interface UserSearchSelectProps {
	/** Selected user uuid. */
	value: string
	/** Known label for the current value (renders before any search). */
	label?: string | null
	placeholder?: string
	disabled?: boolean
	inputId?: string
	onChange: (userId: string, user: UserOption | null) => void
}

function mapUser(user: AdminUser): UserOption {
	return {
		value: user.id,
		label: user.mainCharacterName ?? user.id,
		description: user.discordUsername ?? undefined,
		mainCharacterId: user.mainCharacterId,
		discordUsername: user.discordUsername,
	}
}

/** Async member picker → core user uuid, backed by GET /admin/users. */
export function UserSearchSelect({
	value,
	label,
	placeholder = 'Search members by name…',
	disabled = false,
	inputId,
	onChange,
}: UserSearchSelectProps) {
	const searchDelegate = useCallback(async (query: string): Promise<UserOption[]> => {
		const { data } = await api.getAdminUsers({ search: query })
		return data.map(mapUser)
	}, [])

	return (
		<Select<UserOption>
			inputId={inputId}
			value={value}
			options={
				value ? [{ value, label: label ?? value, mainCharacterId: null, discordUsername: null }] : []
			}
			searchable
			searchDelegate={searchDelegate}
			minQueryLength={2}
			placeholder={placeholder}
			disabled={disabled}
			onValueChange={(nextValue, option) => onChange(nextValue, option)}
			loadingText="Searching members…"
			emptyText="No matching members"
			queryHintText="Type at least 2 characters"
			renderOption={(option) => (
				<div className="flex min-w-0 items-center gap-2">
					{option.mainCharacterId ? (
						<img
							src={characterPortraitUrl(option.mainCharacterId, 32)}
							alt=""
							width={28}
							height={28}
							className="h-7 w-7 shrink-0 rounded-full"
						/>
					) : (
						<div className="h-7 w-7 shrink-0 rounded-full bg-muted" />
					)}
					<div className="min-w-0">
						<div className="truncate font-medium" title={option.label}>
							{option.label}
						</div>
						{option.discordUsername ? (
							<div
								className="truncate text-xs text-muted-foreground"
								title={option.discordUsername}
							>
								{option.discordUsername}
							</div>
						) : null}
					</div>
				</div>
			)}
		/>
	)
}

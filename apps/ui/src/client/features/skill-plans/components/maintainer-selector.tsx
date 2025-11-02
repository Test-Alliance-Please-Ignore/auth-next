import { useEffect, useState } from 'react'
import { User, Users } from 'lucide-react'
import { useAuth } from '../../../hooks/useAuth'
import { useGroups } from '../../../hooks/useGroups'
import { Label } from '../../../components/ui/label'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '../../../components/ui/select'
import type { MaintainerOption } from '../types'

interface MaintainerSelectorProps {
	value: string | null
	onChange: (value: string | null) => void
	disabled?: boolean
	required?: boolean
}

export function MaintainerSelector({
	value,
	onChange,
	disabled = false,
	required = false,
}: MaintainerSelectorProps) {
	const { user } = useAuth()
	const { data: groups, isLoading: groupsLoading } = useGroups()
	const [options, setOptions] = useState<MaintainerOption[]>([])

	useEffect(() => {
		const maintainerOptions: MaintainerOption[] = []

		// Add current user as an option
		if (user) {
			const primaryChar = user.characters.find((c) => c.characterId === user.mainCharacterId)
			maintainerOptions.push({
				id: user.id,
				name: primaryChar?.characterName || 'Me (Personal)',
				type: 'user',
			})
		}

		// Add groups the user is a member of
		if (groups) {
			// Filter to groups where user is a member
			// In a real app, we'd need to check membership through another API
			// For now, we'll show all groups
			groups.forEach((group) => {
				maintainerOptions.push({
					id: `group:${group.id}`,
					name: group.name,
					type: 'group',
				})
			})
		}

		setOptions(maintainerOptions)
	}, [user, groups])

	const selectedOption = options.find((opt) => opt.id === value)

	return (
		<div className="space-y-2">
			<Label htmlFor="maintainer">
				Maintainer {required && <span className="text-destructive">*</span>}
			</Label>
			<Select
				value={value || 'none'}
				onValueChange={(val) => onChange(val === 'none' ? null : val)}
				disabled={disabled || groupsLoading}
			>
				<SelectTrigger id="maintainer">
					<SelectValue>
						{selectedOption ? (
							<div className="flex items-center gap-2">
								{selectedOption.type === 'group' ? (
									<Users className="h-4 w-4" />
								) : (
									<User className="h-4 w-4" />
								)}
								<span>{selectedOption.name}</span>
							</div>
						) : (
							'Select maintainer...'
						)}
					</SelectValue>
				</SelectTrigger>
				<SelectContent>
					{!required && (
						<SelectItem value="none">
							<div className="flex items-center gap-2">
								<User className="h-4 w-4 opacity-50" />
								<span>No maintainer</span>
							</div>
						</SelectItem>
					)}
					{options.map((option) => (
						<SelectItem key={option.id} value={option.id}>
							<div className="flex items-center gap-2">
								{option.type === 'group' ? (
									<Users className="h-4 w-4" />
								) : (
									<User className="h-4 w-4" />
								)}
								<span>{option.name}</span>
							</div>
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<p className="text-sm text-muted-foreground">
				The maintainer can edit and delete this plan. Groups allow any member to maintain the plan.
			</p>
		</div>
	)
}
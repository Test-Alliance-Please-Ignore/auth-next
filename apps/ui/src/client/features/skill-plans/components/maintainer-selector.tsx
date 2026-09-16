import { useMemo } from 'react'

import { useAppTranslation } from '@/i18n'

import { Label } from '../../../components/ui/label'
import { Select } from '../../../components/ui/select'
import { useAuth } from '../../../hooks/useAuth'
import { useUserMemberships } from '../../../hooks/useGroups'

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
	const { t } = useAppTranslation()

	const { user } = useAuth()
	const { data: memberships, isLoading: membershipsLoading } = useUserMemberships()
	const options = useMemo<MaintainerOption[]>(() => {
		const maintainerOptions: MaintainerOption[] = []

		if (user) {
			const primaryChar = user.characters.find((c) => c.characterId === user.mainCharacterId)
			maintainerOptions.push({
				id: user.id,
				name: primaryChar?.characterName || t('skillPlans.me'),
				type: 'user',
			})
		}

		if (memberships) {
			memberships.forEach((membership) => {
				maintainerOptions.push({
					id: `group:${membership.groupId}`,
					name: membership.groupName,
					type: 'group',
				})
			})
		}

		return maintainerOptions
	}, [memberships, user, t])

	return (
		<div className="space-y-2" data-component="searchable-maintainer-selector">
			<Label htmlFor="maintainer">
				{t('skillPlans.maintainer')}
				{required && <span className="text-destructive">*</span>}
			</Label>
			<p className="text-sm text-muted-foreground">
				{t('skillPlans.chooseYourselfOrOneOfYourGroupsTheSelectedMaintainer')}
			</p>
			<Select
				value={value || 'none'}
				onValueChange={(val) => onChange(val === 'none' ? null : val)}
				inputId="maintainer"
				searchable
				options={[
					...(!required ? [{ value: 'none', label: t('skillPlans.noMaintainer') }] : []),
					...options.map((option) => ({
						value: option.id,
						label: option.name,
						description: option.type === 'group' ? t('skillPlans.group') : t('skillPlans.user'),
					})),
				]}
				placeholder={t('skillPlans.selectMaintainer')}
				disabled={disabled || membershipsLoading}
			/>
		</div>
	)
}

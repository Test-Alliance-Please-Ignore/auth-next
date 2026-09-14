import { afterEach, describe, expect, it } from 'vitest'

import { i18n, setAppLocale } from '@/i18n'
import {
	groupDiscordRoleAssignmentSections,
	groupDiscordRoleAssignmentSummaryKey,
} from '@/routes/admin/group-discord-role-sections'

describe('group Discord role assignment sections', () => {
	afterEach(() => setAppLocale('en', { persistLocal: false }))

	it.each([
		['en', 'Members', 'Owners/Admins', 'stack on top'],
		['de', 'Mitglieder', 'Eigentümer/Administratoren', 'zusätzlich'],
		['ko', '구성원', '소유자/관리자', '추가로'],
	] as const)(
		'keeps assignment targets and explains additive roles in %s',
		async (locale, members, admins, additive) => {
			await setAppLocale(locale, { persistLocal: false })
			expect(
				groupDiscordRoleAssignmentSections.map((section) => ({
					target: section.membershipType,
					label: i18n.t(section.labelKey),
				}))
			).toEqual([
				{ target: 'member', label: members },
				{ target: 'owner_admin', label: admins },
			])
			expect(i18n.t(groupDiscordRoleAssignmentSummaryKey)).toContain(additive)
		}
	)
})

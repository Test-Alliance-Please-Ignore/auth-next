import { OPEN_APPLICATION_STATUSES } from '../constants'

import type { HrRoleType } from '../../hr/api'
import type { ApplicationStatus } from '../api'

type FulcrumAccessInput = {
	applicationStatus?: ApplicationStatus | null
	currentRole?: HrRoleType | null
	isAdmin: boolean
}

export function canViewFulcrumTab({
	applicationStatus,
	currentRole,
	isAdmin,
}: FulcrumAccessInput): boolean {
	if (!applicationStatus || !OPEN_APPLICATION_STATUSES.includes(applicationStatus)) {
		return false
	}

	if (isAdmin) {
		return true
	}

	return currentRole === 'hr_admin' || currentRole === 'hr_reviewer'
}

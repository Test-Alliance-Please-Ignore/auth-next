import { JoinButton } from './join-button'
import { LeaveButton } from './leave-button'

import type { GroupWithDetails } from '@/lib/api'

interface GroupMembershipActionProps {
	group: GroupWithDetails
	onSuccess?: () => void
}

/**
 * Compact membership action used by group listings. The detailed controls remain
 * available on the group page, but both surfaces share the same mutations/dialogs.
 */
export function GroupMembershipAction({ group, onSuccess }: GroupMembershipActionProps) {
	if (group.isMember) {
		return <LeaveButton group={group} onSuccess={onSuccess} compact />
	}

	if (
		group.hasPendingJoinRequest ||
		group.joinMode === 'invitation_only' ||
		group.joinMode === 'admin_managed'
	) {
		return null
	}

	if (group.joinMode === 'open' || group.joinMode === 'approval') {
		return <JoinButton group={group} onSuccess={onSuccess} compact />
	}

	return null
}

# Groups Worker Notification Integration Guide

This document describes where to add notification publishing calls in the GroupsDO.

## Setup

1. Import the NotificationService at the top of `durable-object.ts`:

```typescript
import { getStub } from '@repo/do-utils'

import { NotificationService } from './services/notifications'

import type { Notifications } from '@repo/notifications'
```

## Integration Points

### 1. `sendInvitation()` method (around line 877)

**After creating the invitation (line 875-877), add:**

```typescript
// Send notification to invited user
try {
  const group = await this.db.query.groups.findFirst({
    where: eq(groups.id, data.groupId),
    with: { category: true },
  })

  const inviter = await this.getUserInfo(inviterId)

  if (group) {
    const stub = getStub<Notifications>(this.env.NOTIFICATIONS, userLookup.userId)
    await stub.publishNotification(userLookup.userId, {
      type: 'group.invitation.received',
      requiresAck: true,
      data: {
        invitationId: invitation.id,
        groupId: group.id,
        groupName: group.name,
        categoryId: group.categoryId,
        categoryName: group.category.name,
        inviterId,
        inviterName: inviter.mainCharacterName || 'Unknown',
      },
    })
  }
} catch (error) {
  console.error('Failed to send invitation notification:', error)
}
```

### 2. `acceptInvitation()` method (around line 908-955)

**After updating the invitation status (line 947-952), add:**

```typescript
// Send notification to group admins
try {
  const group = await this.db.query.groups.findFirst({
    where: eq(groups.id, invitation.groupId),
  })

  const user = await this.getUserInfo(userId)
  const adminIds = await this.getGroupAdminUserIds(invitation.groupId)

  if (group && adminIds.length > 0) {
    for (const adminId of adminIds) {
      const stub = getStub<Notifications>(this.env.NOTIFICATIONS, adminId)
      await stub.publishNotification(adminId, {
        type: 'group.invitation.accepted',
        requiresAck: false,
        data: {
          invitationId: invitation.id,
          groupId: group.id,
          groupName: group.name,
          userId,
          userName: user.mainCharacterName || 'Unknown',
        },
      })
    }
  }
} catch (error) {
  console.error('Failed to send invitation accepted notification:', error)
}
```

### 3. `joinGroup()` method (around line 423)

**After adding the member (find the insert into groupMembers), add:**

```typescript
// Send notification to group admins
try {
  const group = await this.db.query.groups.findFirst({
    where: eq(groups.id, groupId),
  })

  const user = await this.getUserInfo(userId)
  const adminIds = await this.getGroupAdminUserIds(groupId)

  if (group && adminIds.length > 0) {
    for (const adminId of adminIds) {
      const stub = getStub<Notifications>(this.env.NOTIFICATIONS, adminId)
      await stub.publishNotification(adminId, {
        type: 'group.member.joined',
        requiresAck: false,
        data: {
          groupId: group.id,
          groupName: group.name,
          userId,
          userName: user.mainCharacterName || 'Unknown',
          joinMethod: group.joinMode === 'open' ? 'open' : 'invitation',
        },
      })
    }
  }
} catch (error) {
  console.error('Failed to send member joined notification:', error)
}
```

### 4. `grantAdmin()` method

**After granting admin permissions (find the insert into groupAdmins), add:**

```typescript
// Send notification to new admin
try {
  const group = await this.db.query.groups.findFirst({
    where: eq(groups.id, groupId),
  })

  const granter = await this.getUserInfo(granterUserId)

  if (group) {
    const stub = getStub<Notifications>(this.env.NOTIFICATIONS, userId)
    await stub.publishNotification(userId, {
      type: 'group.admin.granted',
      requiresAck: true,
      data: {
        groupId: group.id,
        groupName: group.name,
        grantedById: granterUserId,
        grantedByName: granter.mainCharacterName || 'Unknown',
      },
    })
  }
} catch (error) {
  console.error('Failed to send admin granted notification:', error)
}
```

### 5. `createJoinRequest()` method (around line 641)

**After creating the join request (find the insert into groupJoinRequests), add:**

```typescript
// Send notification to group admins
try {
  const group = await this.db.query.groups.findFirst({
    where: eq(groups.id, data.groupId),
  })

  const user = await this.getUserInfo(userId)
  const adminIds = await this.getGroupAdminUserIds(data.groupId)

  if (group && adminIds.length > 0) {
    for (const adminId of adminIds) {
      const stub = getStub<Notifications>(this.env.NOTIFICATIONS, adminId)
      await stub.publishNotification(adminId, {
        type: 'group.join_request.created',
        requiresAck: true,
        data: {
          requestId: request.id,
          groupId: group.id,
          groupName: group.name,
          userId,
          userName: user.mainCharacterName || 'Unknown',
          message: data.message,
        },
      })
    }
  }
} catch (error) {
  console.error('Failed to send join request created notification:', error)
}
```

### 6. `approveJoinRequest()` method (around line 729)

**After adding the user as a member (find the insert into groupMembers), add:**

```typescript
// Send notification to requester
try {
  const group = await this.db.query.groups.findFirst({
    where: eq(groups.id, request.groupId),
  })

  const approver = await this.getUserInfo(adminUserId)

  if (group) {
    const stub = getStub<Notifications>(this.env.NOTIFICATIONS, request.userId)
    await stub.publishNotification(request.userId, {
      type: 'group.join_request.approved',
      requiresAck: true,
      data: {
        requestId: request.id,
        groupId: group.id,
        groupName: group.name,
        approvedById: adminUserId,
        approvedByName: approver.mainCharacterName || 'Unknown',
      },
    })
  }
} catch (error) {
  console.error('Failed to send join request approved notification:', error)
}
```

## Helper Method Needed

Add this helper method to the GroupsDO class to get user info:

```typescript
private async getUserInfo(userId: string): Promise<{ mainCharacterName: string | null }> {
	// This should query your users table to get the main character name
	// Adjust based on your actual schema
	return { mainCharacterName: userId } // Placeholder - implement actual logic
}

private async getGroupAdminUserIds(groupId: string): Promise<string[]> {
	const admins = await this.db.query.groupAdmins.findMany({
		where: eq(groupAdmins.groupId, groupId),
	})

	// Get owner
	const group = await this.db.query.groups.findFirst({
		where: eq(groups.id, groupId),
	})

	const adminIds = admins.map(a => a.userId)
	if (group) {
		adminIds.push(group.ownerId)
	}

	return [...new Set(adminIds)] // Deduplicate
}
```

## Notes

- All notification calls are wrapped in try-catch to prevent failures from breaking core functionality
- Notifications are fire-and-forget - they won't block the main operation
- The NotificationService handles getting the correct DO stub per user
- requiresAck is set to `true` for important notifications that users should explicitly acknowledge

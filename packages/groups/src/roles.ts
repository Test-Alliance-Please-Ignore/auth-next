export interface Role {
	id: string
	name: string
	ownedBy: string
	description: string | null
	createdAt: Date
	updatedAt: Date
}

export enum RoleAttachmentType {
	GROUP = 'group',
	CHARACTER = 'character',
	CORPORATION = 'corporation',
	ALLIANCE = 'alliance',
	USER = 'user',
}

export enum ResourceType {
	GROUP = 'group',
	CHARACTER = 'character',
	CORPORATION = 'corporation',
	ALLIANCE = 'alliance',
	USER = 'user',
}

export interface RoleAttachment {
	id: string
	role: Role
	attachedToType: RoleAttachmentType
	attachedToId: string
	resourceId?: string
	resourceType?: ResourceType
	createdAt: Date
	updatedAt: Date
}

export interface CreateRoleRequest {
	name: string
	ownedBy: string
	description: string | null
}

export interface AttachRoleToRequest {
	roleId: string
	attachedToType: RoleAttachmentType
	attachedToId: string
	resourceId?: string
	resourceType?: ResourceType
}

export interface DetachRoleFromRequest {
	roleId: string
	attachedToType: RoleAttachmentType
	attachedToId: string
}

export interface GetRolesForRequest {
	attachedToId?: string
	attachedToType?: RoleAttachmentType
	resourceId?: string
	resourceType?: ResourceType
	roleId?: string
	roleName?: string
	roleIds?: string[]
}

export interface BatchGetRolesForRequest {
	attachedToType: RoleAttachmentType
	attachedToIds: string[]
}

export interface BatchCreateRolesRequest {
	roles: CreateRoleRequest[]
}

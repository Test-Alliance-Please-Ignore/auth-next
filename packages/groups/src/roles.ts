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

export interface RoleAttachment {
	id: string
	roleId: string
	attachedToType: RoleAttachmentType
	attachedToId: string
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
}

export interface DetachRoleFromRequest {
	roleId: string
	attachedToType: RoleAttachmentType
	attachedToId: string
}

export interface GetRolesForRequest {
	attachedToType: RoleAttachmentType
	attachedToId: string
}

export interface BatchGetRolesForRequest {
	attachedToType: RoleAttachmentType
	attachedToIds: string[]
}

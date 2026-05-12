import { getCachedUserPermissions } from './groups-cache'

import type { Env } from '../context'
import type { Hr } from '@repo/hr'
import { resolveHrAccessState as resolveSharedHrAccessState } from '@repo/hr'

type HrAccessArgs = {
	env: Env
	userId: string
	isSiteAdmin: boolean
	hrStub: Hr
}

export async function hasHrAuditorPermission(args: {
	env: Env
	userId: string
}): Promise<boolean> {
	const permissions = await getCachedUserPermissions(args.env, args.userId)
	return permissions.some((p) => p.urn === 'urn:hr:auditor')
}

export async function resolveHrAccessState(args: HrAccessArgs): Promise<{
	hasHrAccess: boolean
	isHrAuditor: boolean
	isSiteAdmin: boolean
}> {
	const isHrAuditor = await hasHrAuditorPermission({
		env: args.env,
		userId: args.userId,
	})
	const hrCorpCount = isHrAuditor
		? 0
		: (await args.hrStub.getUserHrCorporations(args.userId)).length
	return resolveSharedHrAccessState({
		isSiteAdmin: args.isSiteAdmin,
		isHrAuditor,
		hrCorporationCount: hrCorpCount,
	})
}

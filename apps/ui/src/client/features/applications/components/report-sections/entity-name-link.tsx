import type { ReactNode } from 'react'

import { getIdClassification } from '@repo/eve-types'
import { useCharacterOwnership } from '@/hooks/useCharacterOwnerships'
import type { CharacterOwnershipMap } from '@/hooks/useCharacterOwnerships'

export type EntityLinkType = 'character' | 'corporation' | 'alliance' | 'faction' | 'mailing_list' | 'other'

export function getEntityHref(
	entityId: string | number | null | undefined,
	entityType?: EntityLinkType | string | null,
): string | null {
	if (entityId == null) return null
	const id = String(entityId).trim()
	if (!id) return null

	const classification = entityType ?? getIdClassification(id).type
	if (classification === 'character' || classification === 'character_2010_2016' || classification === 'character_post_2016' || classification === 'dust_character' || classification === 'dust_character_post_2016') {
		return `https://evewho.com/character/${id}`
	}
	if (classification === 'corporation') {
		return `https://evewho.com/corporation/${id}`
	}
	if (classification === 'alliance') {
		return `https://evewho.com/alliance/${id}`
	}
	return null
}

export function EntityNameLink({
	entityId,
	entityType,
	href,
	ownershipMap,
	children,
	className,
	title,
}: {
	entityId: string | number | null | undefined
	entityType?: EntityLinkType | string | null
	href?: string | null
	ownershipMap?: CharacterOwnershipMap
	children: ReactNode
	className?: string
	title?: string
}) {
	const fallbackHref = getEntityHref(entityId, entityType)
	const entityClassification = entityId == null ? null : (entityType ?? getIdClassification(String(entityId)).type)
	const entityIdString = entityId == null ? '' : String(entityId).trim()
	const ownershipFromMap = entityIdString ? ownershipMap?.[entityIdString] ?? null : null
	const shouldLookupOwnership =
		!href &&
		!ownershipMap &&
		Boolean(entityIdString) &&
		(entityClassification === 'character' ||
			entityClassification === 'character_2010_2016' ||
			entityClassification === 'character_post_2016' ||
			entityClassification === 'dust_character' ||
			entityClassification === 'dust_character_post_2016')
	const { data: ownership } = useCharacterOwnership(entityIdString, {
		enabled: shouldLookupOwnership,
	})
	const resolvedOwnership = ownershipFromMap ?? ownership ?? null
	const isCharacterLike =
		entityClassification === 'character' ||
		entityClassification === 'character_2010_2016' ||
		entityClassification === 'character_post_2016' ||
		entityClassification === 'dust_character' ||
		entityClassification === 'dust_character_post_2016'
	const finalHref =
		href ??
		(isCharacterLike && resolvedOwnership?.userId ? `/hr/users/${resolvedOwnership.userId}` : fallbackHref)
	if (!finalHref) {
		return <>{children}</>
	}

	return (
		<a
			href={finalHref}
			target="_blank"
			rel="noreferrer"
			title={title}
			className={className ?? 'hover:underline underline-offset-2'}
		>
			{children}
		</a>
	)
}

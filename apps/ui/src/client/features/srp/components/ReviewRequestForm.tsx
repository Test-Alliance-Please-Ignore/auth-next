import { Plus, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { formatList, formatNumber, i18n, useAppTranslation } from '@/i18n'
import toast from '@/lib/toast'

import {
	useDoctrineFittingsForShip,
	useSRPConfig,
	useSRPPolicies,
	useSubmitReview,
	useUpdateReviewState,
} from '../hooks'
import { formatISK, getRequestStatusText } from '../utils'
import {
	transformKillmailToCargoItems,
	transformKillmailToFittingItems,
	transformKillmailToShipMaintenanceBayShips,
} from '../utils/fitting'
import { SRPFeedback } from './SRPFeedback'
import { SRPFittingDisplay } from './SRPFittingDisplay'
import { SRPNumberInput } from './SRPNumberInput'

import type { ReactNode } from 'react'
import type { CapConfig, PayoutModifierConfig } from '@repo/srp'
import type { AppTranslator } from '@/i18n'
import type { FittingWithItems } from '@/lib/api'
import type {
	AppliedModifier,
	SRPPolicy,
	SRPPredefinedAdhocModifier,
	SRPRequestResponse,
} from '../types'
import type {
	SRPFittingItem,
	SRPShipSlotCapacities,
	SRPShipSlotType,
	SRPSlotHighlightMap,
} from '../utils/fitting'

interface ReviewRequestFormProps {
	request: SRPRequestResponse
	onSuccess: () => void
	commentSlot?: ReactNode
	rightAppend?: ReactNode
}

type DoctrineSlot = 'high' | 'mid' | 'low' | 'rig' | 'sub'
type ConformitySeverity = 'destructive' | 'warning' | 'secondary'
const SHIP_SLOT_TYPES: SRPShipSlotType[] = ['high', 'mid', 'low', 'rig', 'sub']
const SHIP_SLOT_ARC_MAX: Record<SRPShipSlotType, number> = {
	high: 8,
	mid: 8,
	low: 8,
	rig: 3,
	sub: 4,
}
const SPLIT_AMMO_WEAPON_GROUP_IDS = new Set<string>([
	// Turrets
	'53', // Energy Weapon
	'55', // Projectile Weapon
	'74', // Hybrid Weapon
	'1986', // Precursor Weapon
	'4060', // Vorton Projector
	// Launchers (missile weapon groups)
	'56', // Missile Launcher (legacy)
	'506', // Missile Launcher Cruise
	'507', // Missile Launcher Rocket
	'508', // Missile Launcher Torpedo
	'509', // Missile Launcher Light
	'510', // Missile Launcher Heavy
	'511', // Missile Launcher Rapid Light
	'512', // Missile Launcher Defender
	'524', // Missile Launcher XL Torpedo
	'771', // Missile Launcher Heavy Assault
	'862', // Missile Launcher Bomb
	'1245', // Missile Launcher Rapid Heavy
	'1673', // Missile Launcher Rapid Torpedo
	'1674', // Missile Launcher XL Cruise
])
interface LossKillmailItem {
	item_type_id?: number
	flag?: number
	quantity_destroyed?: number
	quantity_dropped?: number
	items?: LossKillmailItem[]
}

interface ConformityFinding {
	severity: ConformitySeverity
	message: string
	slot?: DoctrineSlot
	quantity?: number
	expectedModule?: string
	lossTypeId?: string
	lossModule?: string
	highlightWholeSlotType?: boolean
}

const SEVERITY_RANK: Record<ConformitySeverity, number> = {
	secondary: 1,
	warning: 2,
	destructive: 3,
}

function slotFromDoctrineFlag(flagId: string): DoctrineSlot | null {
	const flag = Number.parseInt(flagId, 10)
	if (flag >= 27 && flag <= 34) return 'high'
	if (flag >= 19 && flag <= 26) return 'mid'
	if (flag >= 11 && flag <= 18) return 'low'
	if (flag >= 92 && flag <= 99) return 'rig'
	if (flag >= 125 && flag <= 132) return 'sub'
	return null
}

function slotFromLossFlag(flag: number): DoctrineSlot | null {
	if (flag >= 27 && flag <= 34) return 'high'
	if (flag >= 19 && flag <= 26) return 'mid'
	if (flag >= 11 && flag <= 18) return 'low'
	if (flag >= 92 && flag <= 99) return 'rig'
	if (flag >= 125 && flag <= 132) return 'sub'
	return null
}

function killmailQuantity(item: {
	quantity_destroyed?: number
	quantity_dropped?: number
}): number {
	const quantity = (item.quantity_destroyed ?? 0) + (item.quantity_dropped ?? 0)
	return quantity > 0 ? quantity : 1
}

function doctrineQuantity(quantity: string): number {
	const parsed = Number.parseInt(quantity, 10)
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

function predefinedModifierOptionLabel(
	modifier: SRPPredefinedAdhocModifier,
	t: AppTranslator
): string {
	const sign = modifier.modifierType === 'deduction' ? '−' : '+'
	const unit = modifier.mode === 'percentage' ? '%' : t('srp.common.millionIsk')
	return `${modifier.reason} (${sign}${formatNumber(modifier.amount)}${unit})`
}

function buildDoctrineCountsBySlot(
	fitting: FittingWithItems
): Map<DoctrineSlot, Map<string, number>> {
	const bySlot = new Map<DoctrineSlot, Map<string, number>>()
	for (const item of fitting.fittingItems) {
		const slot = slotFromDoctrineFlag(item.flagId)
		if (!slot) continue
		const slotMap = bySlot.get(slot) ?? new Map<string, number>()
		slotMap.set(item.typeId, (slotMap.get(item.typeId) ?? 0) + doctrineQuantity(item.quantity))
		bySlot.set(slot, slotMap)
	}
	return bySlot
}

function buildLossCountsBySlot(
	killmailItems: LossKillmailItem[]
): Map<DoctrineSlot, Map<string, number>> {
	const bySlot = new Map<DoctrineSlot, Map<string, number>>()
	for (const item of killmailItems) {
		if (item.item_type_id == null || item.flag == null) continue
		const slot = slotFromLossFlag(item.flag)
		if (!slot) continue
		const typeId = String(item.item_type_id)
		const slotMap = bySlot.get(slot) ?? new Map<string, number>()
		slotMap.set(typeId, (slotMap.get(typeId) ?? 0) + killmailQuantity(item))
		bySlot.set(slot, slotMap)
	}
	return bySlot
}

function stripConsumablesFromDoctrineFitting(
	fitting: FittingWithItems,
	consumableTypeIds: Set<string>
): FittingWithItems {
	return {
		...fitting,
		fittingItems: fitting.fittingItems.filter((item) => !consumableTypeIds.has(item.typeId)),
	}
}

function filterKillmailForConformity(
	killmailItems: LossKillmailItem[],
	consumableTypeIds: Set<string>
): LossKillmailItem[] {
	return killmailItems.filter(
		(item) => item.item_type_id == null || !consumableTypeIds.has(String(item.item_type_id))
	)
}

function collectConsumableChildrenForHighModule(
	items: LossKillmailItem[] | undefined,
	consumableTypeIds: Set<string>,
	ammoByType: Map<string, number>
): boolean {
	if (!items || items.length === 0) return false
	let found = false
	for (const child of items) {
		if (child.item_type_id != null) {
			const typeId = String(child.item_type_id)
			if (consumableTypeIds.has(typeId)) {
				ammoByType.set(typeId, (ammoByType.get(typeId) ?? 0) + killmailQuantity(child))
				found = true
			}
		}
		if (collectConsumableChildrenForHighModule(child.items, consumableTypeIds, ammoByType)) {
			found = true
		}
	}
	return found
}

function analyzeHighSlotAmmoDistribution(
	killmailItems: LossKillmailItem[],
	consumableTypeIds: Set<string>,
	itemNames: Record<string, string>,
	itemGroupIds: Record<string, string>,
	t: AppTranslator
): {
	weaponModuleCount: number
	moduleSystemCount: number
	totalAmmoQuantity: number
	ammoTypeCount: number
	ammoTypeNames: string[]
	hasMixedAmmoWithinSameWeaponSystem: boolean
	mixedWeaponSystemNames: string[]
	unevenAmmoByType: Array<{
		ammoTypeId: string
		ammoTypeName: string
		ammoQuantity: number
		matchingWeaponCount: number
	}>
} {
	const ammoByType = new Map<string, number>()
	const matchingWeaponCountByAmmoType = new Map<string, number>()
	const ammoTypesByWeaponSystem = new Map<string, Set<string>>()
	const weaponSystemNames = new Map<string, string>()
	const weaponSystemCountByType = new Map<string, number>()
	let weaponModuleCount = 0

	for (const item of killmailItems) {
		if (item.item_type_id == null || item.flag == null) continue
		if (slotFromLossFlag(item.flag) !== 'high') continue
		if (consumableTypeIds.has(String(item.item_type_id))) continue
		const moduleTypeId = String(item.item_type_id)
		const groupId = itemGroupIds[moduleTypeId]
		if (!groupId || !SPLIT_AMMO_WEAPON_GROUP_IDS.has(groupId)) continue
		const moduleCount = killmailQuantity(item)
		const moduleAmmoByType = new Map<string, number>()
		const hasLoadedAmmo = collectConsumableChildrenForHighModule(
			item.items,
			consumableTypeIds,
			moduleAmmoByType
		)
		if (!hasLoadedAmmo) continue

		weaponModuleCount += moduleCount
		weaponSystemCountByType.set(
			moduleTypeId,
			(weaponSystemCountByType.get(moduleTypeId) ?? 0) + moduleCount
		)
		weaponSystemNames.set(
			moduleTypeId,
			itemNames[moduleTypeId] ?? t('srp.common.typeId', { id: moduleTypeId })
		)

		const systemAmmoTypes = ammoTypesByWeaponSystem.get(moduleTypeId) ?? new Set<string>()
		for (const [ammoTypeId, ammoQty] of moduleAmmoByType) {
			systemAmmoTypes.add(ammoTypeId)
			ammoByType.set(ammoTypeId, (ammoByType.get(ammoTypeId) ?? 0) + ammoQty)
			matchingWeaponCountByAmmoType.set(
				ammoTypeId,
				(matchingWeaponCountByAmmoType.get(ammoTypeId) ?? 0) + moduleCount
			)
		}
		ammoTypesByWeaponSystem.set(moduleTypeId, systemAmmoTypes)
	}

	const totalAmmoQuantity = [...ammoByType.values()].reduce((sum, quantity) => sum + quantity, 0)
	const ammoTypeNames = [...ammoByType.keys()].map(
		(typeId) => itemNames[typeId] ?? t('srp.common.typeId', { id: typeId })
	)
	const mixedWeaponSystemNames = [...ammoTypesByWeaponSystem.entries()]
		.filter(([, ammoTypes]) => ammoTypes.size > 1)
		.map(
			([moduleTypeId]) =>
				weaponSystemNames.get(moduleTypeId) ?? t('srp.common.typeId', { id: moduleTypeId })
		)
	const unevenAmmoByType = [...ammoByType.entries()]
		.map(([ammoTypeId, ammoQuantity]) => {
			const matchingWeaponCount = matchingWeaponCountByAmmoType.get(ammoTypeId) ?? 0
			if (
				matchingWeaponCount <= 0 ||
				ammoQuantity <= 0 ||
				ammoQuantity % matchingWeaponCount === 0
			) {
				return null
			}
			return {
				ammoTypeId,
				ammoTypeName: itemNames[ammoTypeId] ?? t('srp.common.typeId', { id: ammoTypeId }),
				ammoQuantity,
				matchingWeaponCount,
			}
		})
		.filter((entry): entry is NonNullable<typeof entry> => entry !== null)

	return {
		weaponModuleCount,
		moduleSystemCount: weaponSystemCountByType.size,
		totalAmmoQuantity,
		ammoTypeCount: ammoByType.size,
		ammoTypeNames,
		hasMixedAmmoWithinSameWeaponSystem: mixedWeaponSystemNames.length > 0,
		mixedWeaponSystemNames,
		unevenAmmoByType,
	}
}

function scoreFittingOverlap(
	fitting: FittingWithItems,
	killmailItemsForConformity: LossKillmailItem[]
): number {
	const doctrine = buildDoctrineCountsBySlot(fitting)
	const loss = buildLossCountsBySlot(killmailItemsForConformity)
	let score = 0
	for (const [slot, expected] of doctrine) {
		const actual = loss.get(slot)
		if (!actual) continue
		for (const [typeId, quantity] of expected) {
			score += Math.min(quantity, actual.get(typeId) ?? 0)
		}
	}
	return score
}

export function computeDoctrineConformityFindings(
	fitting: FittingWithItems,
	killmailItemsForConformity: LossKillmailItem[],
	killmailItemsForAmmoCheck: LossKillmailItem[],
	doctrineCargoTypeIds: Set<string>,
	consumableTypeIds: Set<string>,
	itemNames: Record<string, string>,
	killmailItemGroupIds: Record<string, string> = {},
	t: AppTranslator = i18n.t
): ConformityFinding[] {
	const findings: ConformityFinding[] = []
	const doctrineBySlot = buildDoctrineCountsBySlot(fitting)
	const lossBySlot = buildLossCountsBySlot(killmailItemsForConformity)
	const doctrineTypeNames = new Map<string, string>()
	for (const item of fitting.fittingItems) {
		if (!doctrineTypeNames.has(item.typeId)) doctrineTypeNames.set(item.typeId, item.typeName)
	}
	const typeName = (typeId: string) =>
		doctrineTypeNames.get(typeId) ?? itemNames[typeId] ?? t('srp.common.typeId', { id: typeId })

	const expectedRigCount = [...(doctrineBySlot.get('rig')?.values() ?? [])].reduce(
		(sum, quantity) => sum + quantity,
		0
	)
	const actualRigCount = [...(lossBySlot.get('rig')?.values() ?? [])].reduce(
		(sum, quantity) => sum + quantity,
		0
	)
	const missingRigs = Math.max(0, expectedRigCount - actualRigCount)
	if (missingRigs > 0) {
		findings.push({
			severity: 'destructive',
			slot: 'rig',
			message: t('srp.review.missingRigs', { count: missingRigs }),
			quantity: missingRigs,
		})
	}

	for (const [slot, expectedTypes] of doctrineBySlot) {
		const actualAll = new Map(lossBySlot.get(slot) ?? [])
		const deficits = new Map<string, number>()

		// Order-independent matching: consume exact type matches first.
		for (const [expectedTypeId, expectedQty] of expectedTypes) {
			const actualQty = actualAll.get(expectedTypeId) ?? 0
			const matchedQty = Math.min(expectedQty, actualQty)
			const remainingExpected = expectedQty - matchedQty
			if (remainingExpected > 0) deficits.set(expectedTypeId, remainingExpected)
			if (actualQty > matchedQty) {
				actualAll.set(expectedTypeId, actualQty - matchedQty)
			} else {
				actualAll.delete(expectedTypeId)
			}
		}

		// Extras must include surplus copies of expected types too (not only totally unknown types),
		// otherwise duplicate modules can hide real mismatches.
		const extras = [...actualAll.entries()]
			.filter(([, qty]) => qty > 0)
			.map(([typeId, qty]) => ({ typeId, qty }))

		for (const [expectedTypeId, expectedQtyMissing] of deficits) {
			let remaining = expectedQtyMissing
			while (remaining > 0) {
				const extra = extras.find((entry) => entry.qty > 0)
				if (!extra) break
				const pairQty = Math.min(remaining, extra.qty)
				const likelyVariation = doctrineCargoTypeIds.has(extra.typeId)
				findings.push({
					severity: likelyVariation ? 'secondary' : 'warning',
					slot,
					quantity: pairQty,
					message: `${t(likelyVariation ? 'srp.review.likelyVariation' : 'srp.review.moduleDiffers')}${pairQty > 1 ? ` ×${formatNumber(pairQty)}` : ''}`,
					expectedModule: typeName(expectedTypeId),
					lossTypeId: extra.typeId,
					lossModule: typeName(extra.typeId),
				})
				remaining -= pairQty
				extra.qty -= pairQty
			}

			if (remaining > 0) {
				findings.push({
					severity: 'destructive',
					slot,
					quantity: remaining,
					message: `${t('srp.review.missingModule', { slot: t(`srp.fitting.slot.${slot}`) })}${remaining > 1 ? ` ×${formatNumber(remaining)}` : ''}`,
					expectedModule: typeName(expectedTypeId),
				})
			}
		}

		// Leftover extras are additional modules vs doctrine baseline (including doctrine-intended empties).
		for (const extra of extras.filter((entry) => entry.qty > 0)) {
			findings.push({
				severity: 'secondary',
				slot,
				quantity: extra.qty,
				message: `${t('srp.review.extraModule')}${extra.qty > 1 ? ` ×${formatNumber(extra.qty)}` : ''}`,
				lossTypeId: extra.typeId,
				lossModule: typeName(extra.typeId),
			})
		}
	}

	const ammoCheck = analyzeHighSlotAmmoDistribution(
		killmailItemsForAmmoCheck,
		consumableTypeIds,
		itemNames,
		killmailItemGroupIds,
		t
	)
	const hasMultipleAmmoTypes = ammoCheck.ammoTypeCount > 1
	const hasUnevenAmmoDistribution = ammoCheck.unevenAmmoByType.length > 0
	const hasPlausibleSplitAcrossDistinctWeaponSystems =
		hasMultipleAmmoTypes &&
		ammoCheck.moduleSystemCount > 0 &&
		ammoCheck.ammoTypeCount === ammoCheck.moduleSystemCount &&
		!ammoCheck.hasMixedAmmoWithinSameWeaponSystem
	const shouldWarnSplitWeapons =
		ammoCheck.hasMixedAmmoWithinSameWeaponSystem ||
		hasUnevenAmmoDistribution ||
		(hasMultipleAmmoTypes && !hasPlausibleSplitAcrossDistinctWeaponSystems)
	if (shouldWarnSplitWeapons) {
		const reasons: string[] = []
		if (ammoCheck.hasMixedAmmoWithinSameWeaponSystem) {
			reasons.push(
				t('srp.review.mixedAmmo', { names: formatList(ammoCheck.mixedWeaponSystemNames) })
			)
		}
		if (hasUnevenAmmoDistribution) {
			reasons.push(
				...ammoCheck.unevenAmmoByType.map((entry) =>
					t('srp.review.unevenAmmo', {
						name: entry.ammoTypeName,
						quantity: entry.ammoQuantity,
						weapons: entry.matchingWeaponCount,
					})
				)
			)
		}
		if (hasMultipleAmmoTypes && !hasPlausibleSplitAcrossDistinctWeaponSystems) {
			reasons.push(t('srp.review.multipleAmmo', { names: formatList(ammoCheck.ammoTypeNames) }))
		}
		findings.push({
			severity: 'warning',
			slot: 'high',
			message: t('srp.review.splitWeapons', { reasons: formatList(reasons) }),
			highlightWholeSlotType: true,
		})
	}

	return findings
}

function setSlotSeverity(
	highlights: SRPSlotHighlightMap,
	slotKey: string,
	severity: ConformitySeverity
): void {
	const current = highlights[slotKey]
	if (!current || SEVERITY_RANK[severity] > SEVERITY_RANK[current]) {
		highlights[slotKey] = severity
	}
}

function buildConformitySlotHighlights(
	findings: ConformityFinding[],
	fittingItems: SRPFittingItem[]
): SRPSlotHighlightMap {
	const highlights: SRPSlotHighlightMap = {}
	for (const finding of findings) {
		if (!finding.slot) continue
		if (finding.highlightWholeSlotType) {
			for (const item of fittingItems) {
				if (item.isConsumable) continue
				if (item.slotType !== finding.slot) continue
				setSlotSeverity(highlights, `${item.slotType}:${item.slotIndex}`, finding.severity)
			}
			continue
		}

		if (finding.lossTypeId) {
			const matches = fittingItems.filter(
				(item) =>
					item.slotType === finding.slot && item.typeId === finding.lossTypeId && !item.isConsumable
			)
			for (const item of matches) {
				setSlotSeverity(highlights, `${item.slotType}:${item.slotIndex}`, finding.severity)
			}
		}
	}
	return highlights
}

export function addEmptySlotDeviationHighlights(
	baseHighlights: SRPSlotHighlightMap,
	fittingItems: SRPFittingItem[],
	slotCapacities: SRPShipSlotCapacities,
	doctrineExpectedCounts: Partial<Record<SRPShipSlotType, number>> | null
): SRPSlotHighlightMap {
	const next: SRPSlotHighlightMap = { ...baseHighlights }
	for (const slot of SHIP_SLOT_TYPES) {
		const capacity = Math.max(0, Math.min(SHIP_SLOT_ARC_MAX[slot], slotCapacities[slot] ?? 0))
		if (capacity <= 0) continue
		const occupied = new Set(
			fittingItems
				.filter((item) => item.slotType === slot && !item.isConsumable)
				.map((item) => item.slotIndex)
		)
		const emptyIndices: number[] = []
		for (let slotIndex = 0; slotIndex < capacity; slotIndex += 1) {
			if (!occupied.has(slotIndex)) emptyIndices.push(slotIndex)
		}
		if (emptyIndices.length === 0) continue

		const expected = doctrineExpectedCounts ? (doctrineExpectedCounts[slot] ?? 0) : null
		const intentionalEmptyCount = expected === null ? 0 : Math.max(0, capacity - expected)
		const criticalEmptyCount = Math.max(0, emptyIndices.length - intentionalEmptyCount)

		for (let i = 0; i < criticalEmptyCount; i += 1) {
			const slotIndex = emptyIndices[i]
			setSlotSeverity(next, `${slot}:${slotIndex}`, 'destructive')
		}
		for (let i = criticalEmptyCount; i < emptyIndices.length; i += 1) {
			const slotIndex = emptyIndices[i]
			setSlotSeverity(next, `${slot}:${slotIndex}`, 'secondary')
		}
	}
	return next
}

function isPayoutModifierConfig(c: unknown): c is PayoutModifierConfig {
	return typeof c === 'object' && c !== null && 'rate' in c
}

function isCapConfig(c: unknown): c is CapConfig {
	return typeof c === 'object' && c !== null && 'maxPayoutMillions' in c
}

function roundToNearestMillion(isk: number): number {
	if (isk > 0 && isk < 1_000_000) return 1_000_000
	return Math.round(isk / 1_000_000) * 1_000_000
}

// Payout computation — mirrors the backend logic
function computePayout(
	equipmentValue: number,
	netInsurance: number,
	modifierPolicy: SRPPolicy | null,
	capPolicy: SRPPolicy | null,
	modifiers: AppliedModifier[],
	overrideMillions: number | null
): number {
	if (overrideMillions !== null && overrideMillions > 0) {
		return overrideMillions * 1_000_000
	}

	let base = equipmentValue

	// Insurance delta: applied by default unless a policy explicitly disables it
	const applyInsuranceDelta =
		modifierPolicy && isPayoutModifierConfig(modifierPolicy.config)
			? modifierPolicy.config.applyInsuranceDelta
			: true
	if (applyInsuranceDelta) {
		base = Math.max(0, base - netInsurance)
	}

	if (modifierPolicy && isPayoutModifierConfig(modifierPolicy.config)) {
		base = base * parseFloat(modifierPolicy.config.rate)
	}

	// Apply ad-hoc modifiers
	for (const mod of modifiers) {
		if (mod.mode === 'percentage') {
			const factor = mod.modifierType === 'deduction' ? 1 - mod.amount / 100 : 1 + mod.amount / 100
			base = base * factor
		} else {
			const delta = mod.amount * 1_000_000
			base = mod.modifierType === 'deduction' ? base - delta : base + delta
		}
	}

	base = Math.max(0, base)

	// Apply cap
	if (capPolicy && isCapConfig(capPolicy.config)) {
		base = Math.min(base, capPolicy.config.maxPayoutMillions * 1_000_000)
	}

	return roundToNearestMillion(base)
}

export function ReviewRequestForm({
	request,
	onSuccess,
	commentSlot,
	rightAppend,
}: ReviewRequestFormProps) {
	const { t } = useAppTranslation()
	const { data: policies = [] } = useSRPPolicies()
	const { data: srpConfig } = useSRPConfig()
	const submitMutation = useSubmitReview()
	const updateStateMutation = useUpdateReviewState()

	const modifierPolicies = useMemo(
		() =>
			policies
				.filter((p) => p.effect === 'payout_modifier' && p.isActive)
				.sort((left, right) => left.displayOrder - right.displayOrder),
		[policies]
	)
	const capPolicies = useMemo(
		() =>
			policies
				.filter((p) => p.effect === 'cap' && p.isActive)
				.sort((left, right) => left.displayOrder - right.displayOrder),
		[policies]
	)

	const [selectedModifierPolicyId, setSelectedModifierPolicyId] = useState<string | null>(null)
	const [selectedCapPolicyId, setSelectedCapPolicyId] = useState<string | null>(null)
	const [modifiers, setModifiers] = useState<AppliedModifier[]>([])
	const [overrideMillions, setOverrideMillions] = useState<number | null>(null)
	const [outcome, setOutcome] = useState<'pending' | 'approved' | 'needs_context' | 'rejected'>(
		'approved'
	)
	const [showConfirm, setShowConfirm] = useState(false)
	const [showDoctrineConformity, setShowDoctrineConformity] = useState(false)
	const [selectedDoctrineFittingId, setSelectedDoctrineFittingId] = useState('')
	const [selectedPredefinedModifierValue, setSelectedPredefinedModifierValue] = useState('')
	const hasInitializedModifierPolicyDefault = useRef(false)
	const hasInitializedCapPolicyDefault = useRef(false)
	const { data: doctrineFittings = [] } = useDoctrineFittingsForShip(request.shipTypeId)
	const predefinedAdhocModifiers: SRPPredefinedAdhocModifier[] = Array.isArray(
		srpConfig?.predefinedAdhocModifiers
	)
		? (srpConfig.predefinedAdhocModifiers as SRPPredefinedAdhocModifier[])
		: []

	const selectedModifierPolicy =
		modifierPolicies.find((p) => p.id === selectedModifierPolicyId) ?? null
	const selectedCapPolicy = capPolicies.find((p) => p.id === selectedCapPolicyId) ?? null

	useEffect(() => {
		const hasPersistedReviewData =
			!!request.reviewedAt ||
			request.appliedModifierPolicyId !== undefined ||
			request.appliedCapPolicyId !== undefined ||
			(request.appliedModifiers?.length ?? 0) > 0 ||
			request.reviewerOverrideMillions !== undefined

		if (!hasPersistedReviewData) {
			return
		}

		setSelectedModifierPolicyId(request.appliedModifierPolicyId ?? null)
		setSelectedCapPolicyId(request.appliedCapPolicyId ?? null)
		setModifiers(
			(request.appliedModifiers ?? []).map((modifier) => ({
				...modifier,
				id: modifier.id || crypto.randomUUID(),
			}))
		)
		setOverrideMillions(request.reviewerOverrideMillions ?? null)
		setOutcome(
			request.requestStatus === 'pending' ||
				request.requestStatus === 'needs_context' ||
				request.requestStatus === 'rejected'
				? request.requestStatus
				: 'approved'
		)

		// Do not auto-select defaults when displaying previously reviewed requests.
		hasInitializedModifierPolicyDefault.current = true
		hasInitializedCapPolicyDefault.current = true
	}, [
		request.id,
		request.reviewedAt,
		request.requestStatus,
		request.appliedModifierPolicyId,
		request.appliedCapPolicyId,
		request.appliedModifiers,
		request.reviewerOverrideMillions,
	])

	useEffect(() => {
		if (modifierPolicies.length === 0) {
			return
		}
		const hasSelected =
			selectedModifierPolicyId !== null &&
			modifierPolicies.some((policy) => policy.id === selectedModifierPolicyId)

		if (!hasInitializedModifierPolicyDefault.current && selectedModifierPolicyId === null) {
			setSelectedModifierPolicyId(modifierPolicies[0].id)
			hasInitializedModifierPolicyDefault.current = true
			return
		}

		if (selectedModifierPolicyId !== null && !hasSelected) {
			setSelectedModifierPolicyId(modifierPolicies[0].id)
		}
	}, [modifierPolicies, selectedModifierPolicyId])

	useEffect(() => {
		if (capPolicies.length === 0) {
			return
		}
		const hasSelected =
			selectedCapPolicyId !== null &&
			capPolicies.some((policy) => policy.id === selectedCapPolicyId)

		if (!hasInitializedCapPolicyDefault.current && selectedCapPolicyId === null) {
			setSelectedCapPolicyId(capPolicies[0].id)
			hasInitializedCapPolicyDefault.current = true
			return
		}

		if (selectedCapPolicyId !== null && !hasSelected) {
			setSelectedCapPolicyId(capPolicies[0].id)
		}
	}, [capPolicies, selectedCapPolicyId])

	const equipmentValue = parseFloat(request.srpEquipmentValue ?? request.shipValue ?? '0')
	const netInsurance = parseFloat(request.srpNetInsurance ?? '0')
	const insurancePremium = parseFloat(request.srpInsurancePremium ?? '0')
	const insurancePayout = parseFloat(request.srpInsurancePayout ?? '0')

	// Hull is the ship itself — find it in srpItemPrices by shipTypeId
	const hullPriceEntry = (request.srpItemPrices ?? []).find((p) => p.typeId === request.shipTypeId)
	const hullValue = hullPriceEntry ? parseFloat(hullPriceEntry.lineTotal) : 0
	const modulesValue = equipmentValue - hullValue

	const computedPayout = computePayout(
		equipmentValue,
		netInsurance,
		selectedModifierPolicy,
		selectedCapPolicy,
		modifiers,
		overrideMillions
	)
	const isZeroPayout = computedPayout === 0

	const itemNames = useMemo(
		() => ({
			...Object.fromEntries((request.srpItemPrices ?? []).map((p) => [p.typeId, p.typeName])),
			...(request.killmailItemNames ?? {}),
		}),
		[request.killmailItemNames, request.srpItemPrices]
	)
	const consumableTypeIds = useMemo(
		() =>
			new Set(
				(request.srpItemPrices ?? []).filter((item) => item.isConsumable).map((item) => item.typeId)
			),
		[request.srpItemPrices]
	)
	const killmailItemsForConformity = useMemo(
		() => filterKillmailForConformity(request.killmailItems ?? [], consumableTypeIds),
		[consumableTypeIds, request.killmailItems]
	)
	const doctrineFittingsForConformity = useMemo(
		() =>
			new Map(
				doctrineFittings.map((fitting) => [
					fitting.id,
					stripConsumablesFromDoctrineFitting(fitting, consumableTypeIds),
				])
			),
		[consumableTypeIds, doctrineFittings]
	)
	const fittingItems = transformKillmailToFittingItems(
		request.killmailItems ?? [],
		(request.srpItemPrices ?? []).map((p) => ({
			typeId: p.typeId,
			price: p.unitPrice,
			isConsumable: p.isConsumable,
		})),
		itemNames
	)
	const cargoItems = transformKillmailToCargoItems(request.killmailItems ?? [], itemNames)
	const shipMaintenanceBayShips = transformKillmailToShipMaintenanceBayShips(
		request.killmailItems ?? [],
		itemNames
	)

	const sortedDoctrineFittings = useMemo(
		() =>
			[...doctrineFittings].sort(
				(left, right) =>
					scoreFittingOverlap(
						doctrineFittingsForConformity.get(right.id) ?? right,
						killmailItemsForConformity
					) -
					scoreFittingOverlap(
						doctrineFittingsForConformity.get(left.id) ?? left,
						killmailItemsForConformity
					)
			),
		[doctrineFittings, doctrineFittingsForConformity, killmailItemsForConformity]
	)

	const activeDoctrineFitting =
		sortedDoctrineFittings.find((fitting) => fitting.id === selectedDoctrineFittingId) ??
		sortedDoctrineFittings[0] ??
		null

	const doctrineCargoTypeIds = useMemo(
		() =>
			new Set(
				(activeDoctrineFitting?.fittingItems ?? [])
					.filter((item) => item.flagId === '5')
					.map((item) => item.typeId)
			),
		[activeDoctrineFitting]
	)
	const doctrineExpectedSlotCounts = useMemo(() => {
		if (!(activeDoctrineFitting && showDoctrineConformity)) return null
		const counts: Partial<Record<SRPShipSlotType, number>> = {}
		for (const item of activeDoctrineFitting.fittingItems) {
			const slot = slotFromDoctrineFlag(item.flagId)
			if (!slot) continue
			counts[slot] = (counts[slot] ?? 0) + doctrineQuantity(item.quantity)
		}
		return counts
	}, [activeDoctrineFitting, showDoctrineConformity])
	const slotCapacities = useMemo(() => {
		const requestCapacities = request.shipSlotCapacities
		const capacities: SRPShipSlotCapacities = {}
		for (const slot of SHIP_SLOT_TYPES) {
			const slotItems = fittingItems.filter((item) => item.slotType === slot && !item.isConsumable)
			const observedMaxIndex = slotItems.reduce((max, item) => Math.max(max, item.slotIndex), -1)
			const observedCapacity = observedMaxIndex + 1
			const doctrineCapacity = doctrineExpectedSlotCounts?.[slot] ?? 0
			const requestedCapacity = requestCapacities?.[slot] ?? 0
			capacities[slot] = Math.max(
				0,
				Math.min(
					SHIP_SLOT_ARC_MAX[slot],
					requestedCapacity > 0 ? requestedCapacity : Math.max(observedCapacity, doctrineCapacity)
				)
			)
		}
		if (requestCapacities?.implant != null) {
			capacities.implant = Math.max(0, Math.min(10, Math.trunc(requestCapacities.implant)))
		}
		return capacities
	}, [doctrineExpectedSlotCounts, fittingItems, request.shipSlotCapacities])

	const doctrineFindings = useMemo(
		() =>
			activeDoctrineFitting && showDoctrineConformity
				? computeDoctrineConformityFindings(
						doctrineFittingsForConformity.get(activeDoctrineFitting.id) ?? activeDoctrineFitting,
						killmailItemsForConformity,
						request.killmailItems ?? [],
						doctrineCargoTypeIds,
						consumableTypeIds,
						itemNames,
						request.killmailItemGroupIds ?? {},
						t
					)
				: [],
		[
			activeDoctrineFitting,
			consumableTypeIds,
			doctrineFittingsForConformity,
			doctrineCargoTypeIds,
			itemNames,
			killmailItemsForConformity,
			request.killmailItemGroupIds,
			request.killmailItems,
			showDoctrineConformity,
			t,
		]
	)
	const conformitySlotHighlights = useMemo(
		() =>
			showDoctrineConformity && doctrineFindings.length > 0
				? buildConformitySlotHighlights(doctrineFindings, fittingItems)
				: {},
		[doctrineFindings, fittingItems, showDoctrineConformity]
	)
	const slotHighlights = useMemo(
		() =>
			addEmptySlotDeviationHighlights(
				conformitySlotHighlights,
				fittingItems,
				slotCapacities,
				doctrineExpectedSlotCounts
			),
		[conformitySlotHighlights, doctrineExpectedSlotCounts, fittingItems, slotCapacities]
	)

	const applyInsurance =
		selectedModifierPolicy && isPayoutModifierConfig(selectedModifierPolicy.config)
			? selectedModifierPolicy.config.applyInsuranceDelta
			: true

	// Compute intermediate values for the math breakdown
	const afterInsurance = applyInsurance
		? Math.max(0, equipmentValue - netInsurance)
		: equipmentValue

	const coverageRate =
		selectedModifierPolicy && isPayoutModifierConfig(selectedModifierPolicy.config)
			? parseFloat(selectedModifierPolicy.config.rate)
			: null

	const afterCoverage = coverageRate !== null ? afterInsurance * coverageRate : afterInsurance
	const coverageReduction =
		coverageRate !== null && coverageRate < 1 ? Math.max(0, afterInsurance - afterCoverage) : 0

	let afterModifiers = afterCoverage
	const modifierLines: Array<{
		label: string
		percentSuffix?: string
		amount: number
		modifierType: 'deduction' | 'bonus'
	}> = []
	for (const mod of modifiers) {
		let delta: number
		if (mod.mode === 'percentage') {
			delta = afterModifiers * (mod.amount / 100)
		} else {
			delta = mod.amount * 1_000_000
		}
		const signed = mod.modifierType === 'deduction' ? -delta : delta
		const percentSuffix =
			mod.mode === 'percentage'
				? ` (${formatNumber(mod.amount / 100, { style: 'percent', maximumFractionDigits: 2 })})`
				: ''
		modifierLines.push({
			label: mod.reason,
			percentSuffix: percentSuffix || undefined,
			amount: signed,
			modifierType: mod.modifierType,
		})
		afterModifiers = afterModifiers + signed
	}
	afterModifiers = Math.max(0, afterModifiers)

	const capPolicy =
		selectedCapPolicy && isCapConfig(selectedCapPolicy.config) ? selectedCapPolicy.config : null
	const isCapped = capPolicy !== null && afterModifiers > capPolicy.maxPayoutMillions * 1_000_000
	const beforeCapAmount = afterModifiers
	const predefinedModifierOptions = predefinedAdhocModifiers.map((modifier, index) => ({
		value: String(index),
		label: predefinedModifierOptionLabel(modifier, t),
	}))

	const addModifier = () => {
		setModifiers((prev) => [
			...prev,
			{
				id: crypto.randomUUID(),
				modifierType: 'deduction',
				mode: 'percentage',
				amount: 10,
				reason: '',
				computedAmountISK: '0',
			},
		])
	}

	const addPredefinedModifier = (value: string) => {
		const index = Number.parseInt(value, 10)
		const template = Number.isFinite(index) ? predefinedAdhocModifiers[index] : undefined
		if (!template) return
		setModifiers((prev) => [
			...prev,
			{
				id: crypto.randomUUID(),
				modifierType: template.modifierType,
				mode: template.mode,
				amount: template.amount,
				reason: template.reason,
				computedAmountISK: '0',
			},
		])
		setSelectedPredefinedModifierValue('')
	}

	const updateModifier = (id: string, updates: Partial<AppliedModifier>) => {
		setModifiers((prev) => prev.map((m) => (m.id === id ? { ...m, ...updates } : m)))
	}

	const removeModifier = (id: string) => {
		setModifiers((prev) => prev.filter((m) => m.id !== id))
	}

	const handleSubmit = async () => {
		if (!showConfirm) {
			setShowConfirm(true)
			return
		}

		// Compute computedAmountISK for each modifier before submitting
		let runningBase = applyInsurance ? Math.max(0, equipmentValue - netInsurance) : equipmentValue
		if (coverageRate !== null) runningBase *= coverageRate

		const finalModifiers: AppliedModifier[] = modifiers.map((mod) => {
			let impact: number
			if (mod.mode === 'percentage') {
				impact = runningBase * (mod.amount / 100)
			} else {
				impact = mod.amount * 1_000_000
			}
			const signed = mod.modifierType === 'deduction' ? -impact : impact
			runningBase = Math.max(0, runningBase + signed)
			return { ...mod, computedAmountISK: String(Math.round(Math.abs(impact))) }
		})

		try {
			if (outcome === 'pending') {
				await updateStateMutation.mutateAsync({
					id: request.id,
					newState: 'pending',
				})
				toast.success(<SRPFeedback messageKey="srp.review.movedToPending" />)
			} else {
				await submitMutation.mutateAsync({
					id: request.id,
					data: {
						outcome,
						appliedModifierPolicyId: selectedModifierPolicyId,
						appliedCapPolicyId: selectedCapPolicyId,
						appliedModifiers: finalModifiers,
						reviewerOverrideMillions: overrideMillions,
						feedbackText: null,
						reviewNotes: null,
					},
				})
				toast.success(<SRPFeedback messageKey="srp.review.submitted" />)
			}
			onSuccess()
		} catch (error: any) {
			toast.error(
				outcome === 'pending' ? (
					<SRPFeedback messageKey="srp.review.moveFailed" />
				) : (
					<SRPFeedback messageKey="srp.review.submitFailed" />
				),
				{ description: error.message }
			)
			setShowConfirm(false)
		}
	}

	return (
		<div className="flex flex-col gap-6 lg:flex-row lg:items-start">
			{/* Left: Fitting display */}
			<div className="flex flex-col gap-4 lg:w-1/2">
				<SRPFittingDisplay
					shipTypeId={request.shipTypeId}
					shipTypeName={request.shipTypeName}
					fittingItems={fittingItems}
					cargoItems={cargoItems}
					shipMaintenanceBayShips={shipMaintenanceBayShips}
					slotHighlights={slotHighlights}
					slotCapacities={slotCapacities}
					middleContent={
						sortedDoctrineFittings.length > 0 ? (
							<Card className="p-4">
								<div className="space-y-3">
									<div className="flex items-center justify-between gap-3">
										<Badge variant="secondary">{t('srp.review.doctrinesAvailable')}</Badge>
										<span className="text-xs text-muted-foreground">
											{t('srp.fitting.count', { count: sortedDoctrineFittings.length })}
										</span>
									</div>
									<div className="flex items-center justify-between gap-3">
										<div>
											<h4 className="text-sm font-semibold">{t('srp.review.showConformity')}</h4>
											<p className="text-xs text-muted-foreground">
												{t('srp.review.conformityHint')}
											</p>
										</div>
										<Switch
											checked={showDoctrineConformity}
											onCheckedChange={setShowDoctrineConformity}
										/>
									</div>
									{showDoctrineConformity && (
										<>
											<Select
												value={activeDoctrineFitting?.id ?? ''}
												onValueChange={setSelectedDoctrineFittingId}
												options={sortedDoctrineFittings.map((fitting) => ({
													value: fitting.id,
													label: fitting.name,
												}))}
												placeholder={t('srp.review.selectFitting')}
											/>
											{doctrineFindings.length === 0 ? (
												<p className="text-sm text-success">{t('srp.review.noIssues')}</p>
											) : (
												<ul className="space-y-2">
													{doctrineFindings.map((finding, index) => (
														<li
															key={`${finding.message}-${index}`}
															className={
																finding.severity === 'destructive'
																	? 'rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2'
																	: finding.severity === 'warning'
																		? 'rounded-md border border-warning/40 bg-warning/10 px-3 py-2'
																		: 'rounded-md border border-secondary/40 bg-secondary/10 px-3 py-2'
															}
														>
															<div className="text-sm font-medium">{finding.message}</div>
															{(finding.expectedModule || finding.lossModule) && (
																<div className="mt-1 text-xs text-muted-foreground">
																	{t('srp.review.expected')}{' '}
																	<span className="font-medium text-foreground">
																		{finding.expectedModule ?? '—'}
																	</span>{' '}
																	{t('srp.review.actualLoss')}{' '}
																	<span className="font-medium text-foreground">
																		{finding.lossModule ?? '—'}
																		{finding.quantity && finding.quantity > 1
																			? ` ×${finding.quantity}`
																			: ''}
																	</span>
																</div>
															)}
														</li>
													))}
												</ul>
											)}
										</>
									)}
								</div>
							</Card>
						) : null
					}
				/>
			</div>

			{/* Right: Review form */}
			<div className="flex flex-col gap-4 lg:w-1/2">
				{/* Math breakdown */}
				<Card className="p-4">
					<h4 className="mb-3 font-semibold text-sm">{t('srp.review.calculation')}</h4>
					<div className="space-y-1 font-mono text-sm">
						<MathRow
							label={t('srp.review.hull', { name: request.shipTypeName ?? t('srp.common.ship') })}
							value={hullValue}
						/>
						{modulesValue > 0 && (
							<MathRow label={t('srp.review.modules')} value={modulesValue} dim />
						)}
						<div className="my-1 border-t border-border/50" />
						<MathRow label={t('srp.review.equipment')} value={equipmentValue} bold />
						{insurancePremium > 0 || insurancePayout > 0 ? (
							<>
								<MathRow label={t('srp.review.insurancePremium')} value={insurancePremium} dim />
								<MathRow
									label={t('srp.review.insurancePayout')}
									value={-insurancePayout}
									dim
									muted={!applyInsurance}
								/>
								{!applyInsurance && (
									<div className="text-right text-xs text-muted-foreground/60">
										{t('srp.review.insuranceOverridden')}
									</div>
								)}
							</>
						) : (
							<div className="flex justify-between text-xs text-muted-foreground/60 italic">
								<span>{t('srp.review.noInsurance')}</span>
								<span>{formatISK(0)}</span>
							</div>
						)}
						<div className="my-1 border-t border-border/50" />
						<MathRow
							label={t('srp.review.baseValue')}
							value={applyInsurance ? afterInsurance : equipmentValue}
							bold
						/>
						{coverageRate !== null && (
							<>
								<div className="flex justify-between text-xs text-muted-foreground">
									<span>{t('srp.review.coverageRate')}</span>
									<span>{Math.round(coverageRate * 100)}%</span>
								</div>
								{coverageReduction > 0 && (
									<MathRow
										label={t('srp.review.coverageReduction')}
										value={-coverageReduction}
										dim
									/>
								)}
								<div className="my-1 border-t border-border/50" />
								<MathRow label={t('srp.review.afterCoverage')} value={afterCoverage} bold />
							</>
						)}
						{modifierLines.map((line, i) => (
							<div key={i} className="flex justify-between text-xs text-muted-foreground">
								<span className="inline-flex items-center gap-2">
									<Badge
										variant={line.modifierType === 'deduction' ? 'destructive' : 'default'}
										className={
											line.modifierType === 'bonus' ? 'bg-green-600 text-white' : undefined
										}
									>
										{line.modifierType === 'deduction'
											? t('srp.common.deduction')
											: t('srp.common.bonus')}
									</Badge>
									<span>
										{line.label}
										{line.percentSuffix && (
											<span className="font-semibold">{line.percentSuffix}</span>
										)}
									</span>
								</span>
								<span className={line.amount >= 0 ? 'text-green-400' : 'text-destructive'}>
									{line.amount >= 0 ? '+' : '-'}
									{formatISK(String(Math.round(Math.abs(line.amount))))}
								</span>
							</div>
						))}
						{modifierLines.length > 0 && (
							<>
								<div className="my-1 border-t border-border/50" />
								<MathRow label={t('srp.review.beforeCap')} value={beforeCapAmount} bold />
							</>
						)}
						{capPolicy && (
							<div className="flex justify-between text-xs text-muted-foreground">
								<span>{t('srp.review.cap', { name: selectedCapPolicy?.name })}</span>
								<span className={isCapped ? 'text-amber-500' : ''}>
									{isCapped
										? `→ ${formatISK(String(capPolicy.maxPayoutMillions * 1_000_000))}`
										: t('srp.review.notApplicable')}
								</span>
							</div>
						)}
						<div className="my-1 border-t-2 border-border" />
						<div className="flex justify-between font-bold">
							<span
								className={overrideMillions !== null ? 'line-through text-muted-foreground' : ''}
							>
								{t('srp.review.suggestedPayout')}
							</span>
							<span
								className={
									overrideMillions !== null
										? 'line-through text-muted-foreground'
										: isZeroPayout
											? 'text-destructive'
											: 'text-green-400'
								}
							>
								{formatISK(String(computedPayout))}
							</span>
						</div>
						{overrideMillions !== null && (
							<div className="flex justify-between font-bold text-green-400">
								<span>{t('srp.review.override')}</span>
								<span>{formatISK(String(overrideMillions * 1_000_000))}</span>
							</div>
						)}
					</div>
				</Card>

				{/* Payout Modifier Policy */}
				{modifierPolicies.length > 0 && (
					<Card className="p-4">
						<h4 className="mb-3 text-sm font-semibold">{t('srp.review.modifierPolicy')}</h4>
						<div className="space-y-2">
							<PolicyRadio
								label={t('srp.review.noModifierPolicy')}
								selected={selectedModifierPolicyId === null}
								onSelect={() => setSelectedModifierPolicyId(null)}
								detail={t('srp.review.noPolicy')}
							/>
							{modifierPolicies.map((p) => {
								const cfg = isPayoutModifierConfig(p.config) ? p.config : null
								return (
									<PolicyRadio
										key={p.id}
										label={p.name}
										selected={selectedModifierPolicyId === p.id}
										onSelect={() => setSelectedModifierPolicyId(p.id)}
										detail={
											cfg
												? t(
														cfg.applyInsuranceDelta
															? 'srp.review.coverageInsurance'
															: 'srp.review.coverageNoInsurance',
														{
															rate: formatNumber(parseFloat(cfg.rate), {
																style: 'percent',
																maximumFractionDigits: 0,
															}),
														}
													)
												: ''
										}
									/>
								)
							})}
						</div>
					</Card>
				)}

				{/* Cap Policy */}
				{capPolicies.length > 0 && (
					<Card className="p-4">
						<h4 className="mb-3 text-sm font-semibold">{t('srp.review.capPolicy')}</h4>
						<div className="space-y-2">
							<PolicyRadio
								label={t('srp.review.noCap')}
								selected={selectedCapPolicyId === null}
								onSelect={() => setSelectedCapPolicyId(null)}
								detail={t('srp.review.noCeiling')}
							/>
							{capPolicies.map((p) => {
								const cfg = isCapConfig(p.config) ? p.config : null
								return (
									<PolicyRadio
										key={p.id}
										label={p.name}
										selected={selectedCapPolicyId === p.id}
										onSelect={() => setSelectedCapPolicyId(p.id)}
										detail={
											cfg
												? t('srp.review.max', {
														amount: formatISK(String(cfg.maxPayoutMillions * 1_000_000)),
													})
												: ''
										}
									/>
								)
							})}
						</div>
					</Card>
				)}

				{/* Ad-hoc Modifiers */}
				<Card className="p-4">
					<h4 className="mb-3 text-sm font-semibold">{t('srp.review.modifiers')}</h4>
					<div className="space-y-2">
						{predefinedModifierOptions.length > 0 && (
							<Select
								value={selectedPredefinedModifierValue}
								onValueChange={(value) => {
									setSelectedPredefinedModifierValue(value)
									addPredefinedModifier(value)
								}}
								options={predefinedModifierOptions}
								placeholder={t('srp.review.applyTemplate')}
								searchable
								emptyText={t('srp.review.noTemplates')}
							/>
						)}
						{modifiers.map((mod) => (
							<div
								key={mod.id}
								className="flex items-center gap-2 rounded-md border border-border/40 p-2"
							>
								<div className="w-32">
									<Select
										value={mod.modifierType}
										onValueChange={(v) => updateModifier(mod.id, { modifierType: v as any })}
										options={[
											{ value: 'deduction', label: t('srp.common.deduction') },
											{ value: 'bonus', label: t('srp.common.bonus') },
										]}
									/>
								</div>
								<div className="w-24">
									<Select
										value={mod.mode}
										onValueChange={(v) => updateModifier(mod.id, { mode: v as any })}
										options={[
											{ value: 'percentage', label: '%' },
											{ value: 'value', label: t('srp.common.millionIsk') },
										]}
									/>
								</div>
								<SRPNumberInput
									min={0}
									value={mod.amount}
									aria-label={t('srp.common.amount')}
									onChange={(value) => updateModifier(mod.id, { amount: parseFloat(value) || 0 })}
									className="h-9 w-20"
								/>
								<Input
									placeholder={t('srp.review.reasonRequired')}
									value={mod.reason}
									onChange={(e) => updateModifier(mod.id, { reason: e.target.value })}
									className="h-9 flex-1"
								/>
								<Button
									variant="ghost"
									size="sm"
									className="h-9 w-9 p-0"
									onClick={() => removeModifier(mod.id)}
									aria-label={t('srp.review.removeModifier')}
								>
									<X className="h-4 w-4" />
								</Button>
							</div>
						))}
						<Button variant="primary" size="sm" onClick={addModifier}>
							<Plus className="mr-1 h-4 w-4" /> {t('srp.review.addModifier')}
						</Button>
					</div>
				</Card>

				{/* Override */}
				<Card className="p-4">
					<h4 className="mb-2 text-sm font-semibold">{t('srp.review.overridePayout')}</h4>
					<div className="flex items-center gap-2">
						<SRPNumberInput
							min={0}
							placeholder={t('srp.review.millions')}
							allowDecimal={false}
							aria-label={t('srp.review.overridePayout')}
							value={overrideMillions ?? ''}
							onChange={(v) => {
								setOverrideMillions(v === '' ? null : parseInt(v, 10) || null)
							}}
							className="w-32"
						/>
						<span className="text-sm text-muted-foreground">
							{t('srp.review.millionMultiplier', { amount: formatNumber(1000000) })}
							{overrideMillions !== null
								? ` = ${formatISK(String(overrideMillions * 1_000_000))}`
								: ''}
						</span>
					</div>
				</Card>

				{/* Outcome + Submit */}
				<Card className="p-4">
					<div className="mb-4 flex items-center gap-3">
						<Label className="text-sm font-semibold">{t('srp.review.outcome')}</Label>
						<div className="flex-1">
							<Select
								value={outcome}
								onValueChange={(v) => {
									setOutcome(v as any)
									setShowConfirm(false)
								}}
								options={[
									{ value: 'pending', label: t('srp.status.pending') },
									{
										value: 'approved',
										label:
											isZeroPayout && overrideMillions === null
												? t('srp.review.zeroPayout')
												: t('srp.status.approved'),
									},
									{ value: 'needs_context', label: t('srp.status.needs_context') },
									{ value: 'rejected', label: t('srp.status.rejected') },
								].filter(
									(opt) => !(opt.value === 'approved' && isZeroPayout && overrideMillions === null)
								)}
							/>
						</div>
					</div>

					<div className="flex gap-2">
						{showConfirm && (
							<Button variant="secondary" onClick={() => setShowConfirm(false)}>
								{t('srp.common.back')}
							</Button>
						)}
						<Button
							className="flex-1"
							onClick={handleSubmit}
							disabled={
								submitMutation.isPending ||
								updateStateMutation.isPending ||
								(isZeroPayout && outcome === 'approved' && overrideMillions === null)
							}
						>
							{submitMutation.isPending || updateStateMutation.isPending
								? t('srp.review.submitting')
								: showConfirm
									? t('srp.review.confirmSubmit')
									: t('srp.review.submit')}
						</Button>
					</div>

					{showConfirm && (
						<div className="mt-4 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-600">
							{t('srp.review.confirmation', {
								status: getRequestStatusText(outcome, t),
								ship: request.shipTypeName,
								amount:
									outcome === 'pending'
										? t('srp.review.unchanged')
										: formatISK(
												String(
													overrideMillions !== null ? overrideMillions * 1000000 : computedPayout
												)
											),
							})}
						</div>
					)}
				</Card>

				{/* Comment slot — passed in from parent */}
				{commentSlot}

				{/* Appended content (comments + history injected from parent) */}
				{rightAppend}
			</div>
		</div>
	)
}

function MathRow({
	label,
	value,
	bold,
	dim,
	muted,
	sign,
}: {
	label: string
	value: number
	bold?: boolean
	dim?: boolean
	muted?: boolean
	sign?: '+' | '-'
}) {
	const cls = muted
		? 'text-muted-foreground/50 text-xs line-through'
		: dim
			? 'text-muted-foreground text-xs'
			: bold
				? 'font-semibold'
				: ''
	const valueTone = muted
		? 'text-muted-foreground/50'
		: value > 0
			? 'text-green-400'
			: value < 0
				? 'text-destructive'
				: ''
	return (
		<div className={`flex justify-between ${cls}`}>
			<span>{label}</span>
			<span className={valueTone}>
				{sign}
				{formatISK(String(Math.round(value)))}
			</span>
		</div>
	)
}

function PolicyRadio({
	label,
	selected,
	onSelect,
	detail,
}: {
	label: string
	selected: boolean
	onSelect: () => void
	detail: string
}) {
	return (
		<label className="flex cursor-pointer items-start gap-2 rounded-md border border-border/40 p-2 hover:bg-muted/20 has-[:checked]:border-primary/50 has-[:checked]:bg-primary/10">
			<input
				type="radio"
				checked={selected}
				onChange={onSelect}
				className="mt-0.5 h-4 w-4 accent-primary"
			/>
			<div>
				<p className="text-sm font-medium">{label}</p>
				{detail && <p className="text-xs text-muted-foreground">{detail}</p>}
			</div>
		</label>
	)
}

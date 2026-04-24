import { Plus, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

import {
	useDoctrineFittingsForShip,
	useSRPConfig,
	useSRPPolicies,
	useSubmitReview,
	useUpdateReviewState,
} from '../hooks'
import { formatISK } from '../utils'
import { transformKillmailToCargoItems, transformKillmailToFittingItems } from '../utils/fitting'
import { SRPFittingDisplay } from './SRPFittingDisplay'

import type { ReactNode } from 'react'
import type { CapConfig, PayoutModifierConfig } from '@repo/srp'
import type { FittingWithItems } from '@/lib/api'
import type {
	AppliedModifier,
	SRPPolicy,
	SRPPredefinedAdhocModifier,
	SRPRequestWithKillmailItemNames,
} from '../types'
import type {
	SRPFittingItem,
	SRPShipSlotCapacities,
	SRPShipSlotType,
	SRPSlotHighlightMap,
} from '../utils/fitting'

interface ReviewRequestFormProps {
	request: SRPRequestWithKillmailItemNames
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

function predefinedModifierOptionLabel(modifier: SRPPredefinedAdhocModifier): string {
	const sign = modifier.modifierType === 'deduction' ? '−' : '+'
	const unit = modifier.mode === 'percentage' ? '%' : 'M ISK'
	return `${modifier.reason} (${sign}${modifier.amount}${unit})`
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

function collectDirectHighSlotConsumables(
	items: LossKillmailItem[],
	consumableTypeIds: Set<string>,
	ammoByType: Map<string, number>,
	parentFlag?: number
): void {
	for (const item of items) {
		const effectiveFlag = item.flag ?? parentFlag
		if (
			effectiveFlag != null &&
			slotFromLossFlag(effectiveFlag) === 'high' &&
			item.item_type_id != null
		) {
			const typeId = String(item.item_type_id)
			if (consumableTypeIds.has(typeId)) {
				ammoByType.set(typeId, (ammoByType.get(typeId) ?? 0) + killmailQuantity(item))
			}
		}
		if (item.items?.length) {
			collectDirectHighSlotConsumables(item.items, consumableTypeIds, ammoByType, effectiveFlag)
		}
	}
}

function analyzeHighSlotAmmoDistribution(
	killmailItems: LossKillmailItem[],
	consumableTypeIds: Set<string>,
	itemNames: Record<string, string>
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
		weaponSystemNames.set(moduleTypeId, itemNames[moduleTypeId] ?? `Type ${moduleTypeId}`)

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

	if (weaponModuleCount === 0) {
		collectDirectHighSlotConsumables(killmailItems, consumableTypeIds, ammoByType)
		let fallbackHighModuleCount = 0
		for (const item of killmailItems) {
			if (item.item_type_id == null || item.flag == null) continue
			if (slotFromLossFlag(item.flag) !== 'high') continue
			if (consumableTypeIds.has(String(item.item_type_id))) continue
			fallbackHighModuleCount += killmailQuantity(item)
		}
		weaponModuleCount = fallbackHighModuleCount
		for (const ammoTypeId of ammoByType.keys()) {
			matchingWeaponCountByAmmoType.set(ammoTypeId, fallbackHighModuleCount)
		}
	}

	const totalAmmoQuantity = [...ammoByType.values()].reduce((sum, quantity) => sum + quantity, 0)
	const ammoTypeNames = [...ammoByType.keys()].map(
		(typeId) => itemNames[typeId] ?? `Type ${typeId}`
	)
	const mixedWeaponSystemNames = [...ammoTypesByWeaponSystem.entries()]
		.filter(([, ammoTypes]) => ammoTypes.size > 1)
		.map(([moduleTypeId]) => weaponSystemNames.get(moduleTypeId) ?? `Type ${moduleTypeId}`)
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
				ammoTypeName: itemNames[ammoTypeId] ?? `Type ${ammoTypeId}`,
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
	itemNames: Record<string, string>
): ConformityFinding[] {
	const findings: ConformityFinding[] = []
	const doctrineBySlot = buildDoctrineCountsBySlot(fitting)
	const lossBySlot = buildLossCountsBySlot(killmailItemsForConformity)
	const doctrineTypeNames = new Map<string, string>()
	for (const item of fitting.fittingItems) {
		if (!doctrineTypeNames.has(item.typeId)) doctrineTypeNames.set(item.typeId, item.typeName)
	}
	const typeName = (typeId: string) =>
		doctrineTypeNames.get(typeId) ?? itemNames[typeId] ?? `Type ${typeId}`

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
			message: `Missing ${missingRigs} rig module${missingRigs === 1 ? '' : 's'}`,
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
					message: `${likelyVariation ? 'Likely doctrine variation' : 'Module differs from doctrine expectation'}${pairQty > 1 ? ` ×${pairQty}` : ''}`,
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
					message: `Missing module in ${slot} slot${remaining > 1 ? ` ×${remaining}` : ''}`,
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
				message: `Additional module not in doctrine expectation${extra.qty > 1 ? ` ×${extra.qty}` : ''}`,
				lossTypeId: extra.typeId,
				lossModule: typeName(extra.typeId),
			})
		}
	}

	const ammoCheck = analyzeHighSlotAmmoDistribution(
		killmailItemsForAmmoCheck,
		consumableTypeIds,
		itemNames
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
				`multiple ammo types loaded within the same weapon system (${ammoCheck.mixedWeaponSystemNames.join(', ')})`
			)
		}
		if (hasUnevenAmmoDistribution) {
			reasons.push(
				...ammoCheck.unevenAmmoByType.map(
					(entry) =>
						`${entry.ammoTypeName} qty ${entry.ammoQuantity} is not evenly divisible by matching weapon count ${entry.matchingWeaponCount}`
				)
			)
		}
		if (hasMultipleAmmoTypes && !hasPlausibleSplitAcrossDistinctWeaponSystems) {
			reasons.push(`multiple ammo types loaded (${ammoCheck.ammoTypeNames.join(', ')})`)
		}
		findings.push({
			severity: 'warning',
			slot: 'high',
			message: `Split weapons variant detected: ${reasons.join('; ')}.`,
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
		if (modifierPolicies.length === 0) {
			if (selectedModifierPolicyId !== null) setSelectedModifierPolicyId(null)
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
			if (selectedCapPolicyId !== null) setSelectedCapPolicyId(null)
			return
		}
		const hasSelected =
			selectedCapPolicyId !== null && capPolicies.some((policy) => policy.id === selectedCapPolicyId)

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
					requestedCapacity > 0
						? requestedCapacity
						: Math.max(observedCapacity, doctrineCapacity)
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
						itemNames
					)
				: [],
		[
			activeDoctrineFitting,
			consumableTypeIds,
			doctrineFittingsForConformity,
			doctrineCargoTypeIds,
			itemNames,
			killmailItemsForConformity,
			request.killmailItems,
			showDoctrineConformity,
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
					? ` (${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(mod.amount)}%)`
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
		label: predefinedModifierOptionLabel(modifier),
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
				toast.success('Request moved to pending')
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
				toast.success('Review submitted successfully')
			}
			onSuccess()
		} catch (error: any) {
			toast.error(
				outcome === 'pending' ? 'Failed to move request to pending' : 'Failed to submit review',
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
					slotHighlights={slotHighlights}
					slotCapacities={slotCapacities}
					middleContent={
						sortedDoctrineFittings.length > 0 ? (
							<Card className="p-4">
								<div className="space-y-3">
									<div className="flex items-center justify-between gap-3">
										<Badge variant="secondary">Military Doctrine Fittings Available</Badge>
										<span className="text-xs text-muted-foreground">
											{sortedDoctrineFittings.length} fitting
											{sortedDoctrineFittings.length === 1 ? '' : 's'}
										</span>
									</div>
									<div className="flex items-center justify-between gap-3">
										<div>
											<h4 className="text-sm font-semibold">Show Doctrine Conformity</h4>
											<p className="text-xs text-muted-foreground">
												Compare this loss against doctrine fittings for this hull
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
												placeholder="Select doctrine fitting"
											/>
											{doctrineFindings.length === 0 ? (
												<p className="text-sm text-success">
													No invariant issues for selected fitting.
												</p>
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
																	Expected:{' '}
																	<span className="font-medium text-foreground">
																		{finding.expectedModule ?? '—'}
																	</span>{' '}
																	| Loss:{' '}
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
					<h4 className="mb-3 font-semibold text-sm">Payout Calculation</h4>
					<div className="space-y-1 font-mono text-sm">
						<MathRow label={`Hull (${request.shipTypeName ?? 'Ship'})`} value={hullValue} />
						{modulesValue > 0 && <MathRow label="+ Modules" value={modulesValue} dim />}
						<div className="my-1 border-t border-border/50" />
						<MathRow label="Equipment Value" value={equipmentValue} bold />
						{insurancePremium > 0 || insurancePayout > 0 ? (
							<>
								<MathRow label="+ Insurance Premium" value={insurancePremium} dim />
								<MathRow
									label="− Insurance Payout"
									value={-insurancePayout}
									dim
									muted={!applyInsurance}
								/>
								{!applyInsurance && (
									<div className="text-right text-xs text-muted-foreground/60">
										(not applied — overridden by selected policy)
									</div>
								)}
							</>
						) : (
							<div className="flex justify-between text-xs text-muted-foreground/60 italic">
								<span>− Insurance (no data)</span>
								<span>{formatISK(0)}</span>
							</div>
						)}
						<div className="my-1 border-t border-border/50" />
						<MathRow
							label="Base Value"
							value={applyInsurance ? afterInsurance : equipmentValue}
							bold
						/>
							{coverageRate !== null && (
								<>
									<div className="flex justify-between text-xs text-muted-foreground">
										<span>× Coverage Rate</span>
										<span>{Math.round(coverageRate * 100)}%</span>
									</div>
									{coverageReduction > 0 && (
										<MathRow label="− Coverage Reduction" value={-coverageReduction} dim />
									)}
									<div className="my-1 border-t border-border/50" />
									<MathRow label="After Coverage" value={afterCoverage} bold />
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
										{line.modifierType === 'deduction' ? 'Deduction' : 'Bonus'}
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
								<MathRow label="Before Cap" value={beforeCapAmount} bold />
							</>
						)}
						{capPolicy && (
							<div className="flex justify-between text-xs text-muted-foreground">
								<span>Cap ({selectedCapPolicy?.name})</span>
									<span className={isCapped ? 'text-amber-500' : ''}>
										{isCapped
											? `→ ${formatISK(String(capPolicy.maxPayoutMillions * 1_000_000))}`
											: 'not applicable'}
									</span>
								</div>
							)}
						<div className="my-1 border-t-2 border-border" />
						<div className="flex justify-between font-bold">
							<span
								className={overrideMillions !== null ? 'line-through text-muted-foreground' : ''}
							>
								Suggested Payout
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
								<span>Override</span>
								<span>{formatISK(String(overrideMillions * 1_000_000))}</span>
							</div>
						)}
					</div>
				</Card>

				{/* Payout Modifier Policy */}
				{modifierPolicies.length > 0 && (
					<Card className="p-4">
						<h4 className="mb-3 text-sm font-semibold">Payout Modifier Policy</h4>
						<div className="space-y-2">
								<PolicyRadio
									label="No Modifier Policy"
									selected={selectedModifierPolicyId === null}
									onSelect={() => setSelectedModifierPolicyId(null)}
									detail="No policy applied"
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
												? `${Math.round(parseFloat(cfg.rate) * 100)}% coverage${cfg.applyInsuranceDelta ? ', insurance deducted' : ', no insurance deduction'}`
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
						<h4 className="mb-3 text-sm font-semibold">Cap Policy</h4>
						<div className="space-y-2">
							<PolicyRadio
								label="No cap"
								selected={selectedCapPolicyId === null}
								onSelect={() => setSelectedCapPolicyId(null)}
								detail="No payout ceiling"
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
											cfg ? `Max: ${formatISK(String(cfg.maxPayoutMillions * 1_000_000))}` : ''
										}
									/>
								)
							})}
						</div>
					</Card>
				)}

				{/* Ad-hoc Modifiers */}
				<Card className="p-4">
					<h4 className="mb-3 text-sm font-semibold">Ad-hoc Modifiers</h4>
					<div className="space-y-2">
						{predefinedModifierOptions.length > 0 && (
								<Select
									value={selectedPredefinedModifierValue}
									onValueChange={(value) => {
										setSelectedPredefinedModifierValue(value)
										addPredefinedModifier(value)
									}}
									options={predefinedModifierOptions}
									placeholder="Apply modifier template"
									searchable
									emptyText="No predefined modifiers"
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
												{ value: 'deduction', label: 'Deduction' },
												{ value: 'bonus', label: 'Bonus' },
											]}
										/>
								</div>
								<div className="w-24">
									<Select
										value={mod.mode}
										onValueChange={(v) => updateModifier(mod.id, { mode: v as any })}
										options={[
											{ value: 'percentage', label: '%' },
											{ value: 'value', label: 'M ISK' },
										]}
									/>
								</div>
								<Input
									type="number"
									min={0}
									value={mod.amount}
									onChange={(e) =>
										updateModifier(mod.id, { amount: parseFloat(e.target.value) || 0 })
									}
									className="h-9 w-20"
								/>
								<Input
									placeholder="Reason (required)"
									value={mod.reason}
									onChange={(e) => updateModifier(mod.id, { reason: e.target.value })}
									className="h-9 flex-1"
								/>
								<Button
									variant="ghost"
									size="sm"
									className="h-9 w-9 p-0"
									onClick={() => removeModifier(mod.id)}
								>
									<X className="h-4 w-4" />
								</Button>
							</div>
						))}
						<Button variant="primary" size="sm" onClick={addModifier}>
							<Plus className="mr-1 h-4 w-4" /> Add Modifier
						</Button>
					</div>
				</Card>

				{/* Override */}
				<Card className="p-4">
					<h4 className="mb-2 text-sm font-semibold">Override Payout</h4>
					<div className="flex items-center gap-2">
						<Input
							type="number"
							min={0}
							placeholder="millions"
							value={overrideMillions ?? ''}
							onChange={(e) => {
								const v = e.target.value
								setOverrideMillions(v === '' ? null : parseInt(v, 10) || null)
							}}
							className="w-32"
						/>
						<span className="text-sm text-muted-foreground">
							× 1,000,000 ISK
							{overrideMillions !== null
								? ` = ${formatISK(String(overrideMillions * 1_000_000))}`
								: ''}
						</span>
					</div>
				</Card>

				{/* Comment slot — passed in from parent */}
				{commentSlot}

				{/* Outcome + Submit */}
				<Card className="p-4">
					<div className="mb-4 flex items-center gap-3">
						<Label className="text-sm font-semibold">Outcome</Label>
						<div className="flex-1">
							<Select
								value={outcome}
								onValueChange={(v) => {
									setOutcome(v as any)
									setShowConfirm(false)
								}}
								options={[
									{ value: 'pending', label: 'Pending' },
									{
										value: 'approved',
										label:
											isZeroPayout && overrideMillions === null
												? 'Approved (payout is zero — must reject)'
												: 'Approved',
									},
									{ value: 'needs_context', label: 'Needs Context' },
									{ value: 'rejected', label: 'Rejected' },
								].filter(
									(opt) => !(opt.value === 'approved' && isZeroPayout && overrideMillions === null)
								)}
							/>
						</div>
					</div>

					{showConfirm && (
						<div className="mb-4 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-600">
							Confirm submission: <strong>{outcome.replace('_', ' ')}</strong> for{' '}
							{request.shipTypeName}? Payout:{' '}
							{outcome === 'pending' ? (
								<strong>unchanged</strong>
							) : (
								<strong>
									{overrideMillions !== null
										? formatISK(String(overrideMillions * 1_000_000))
										: formatISK(String(computedPayout))}
								</strong>
							)}
						</div>
					)}

					<div className="flex gap-2">
						{showConfirm && (
							<Button variant="secondary" onClick={() => setShowConfirm(false)}>
								Back
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
								? 'Submitting…'
								: showConfirm
									? 'Confirm Submit'
									: 'Submit Review'}
						</Button>
					</div>
				</Card>

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

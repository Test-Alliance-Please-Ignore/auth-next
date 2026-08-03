import { describe, expect, it } from 'vitest'

import { isEquippedSlot } from '../../lib/slot-flags'

describe('isEquippedSlot', () => {
	describe('Low slots (11–18)', () => {
		it('excludes flag 10 (below low slots)', () => expect(isEquippedSlot(10)).toBe(false))
		it('includes flag 11 (LoSlot0)', () => expect(isEquippedSlot(11)).toBe(true))
		it('includes flag 14 (LoSlot3)', () => expect(isEquippedSlot(14)).toBe(true))
		it('includes flag 18 (LoSlot7)', () => expect(isEquippedSlot(18)).toBe(true))
	})

	describe('Mid slots (19–26)', () => {
		it('includes flag 19 (MedSlot0)', () => expect(isEquippedSlot(19)).toBe(true))
		it('includes flag 22 (MedSlot3)', () => expect(isEquippedSlot(22)).toBe(true))
		it('includes flag 26 (MedSlot7)', () => expect(isEquippedSlot(26)).toBe(true))
	})

	describe('High slots (27–34)', () => {
		it('includes flag 27 (HiSlot0)', () => expect(isEquippedSlot(27)).toBe(true))
		it('includes flag 30 (HiSlot3)', () => expect(isEquippedSlot(30)).toBe(true))
		it('includes flag 34 (HiSlot7)', () => expect(isEquippedSlot(34)).toBe(true))
		it('excludes flag 35 (above high slots)', () => expect(isEquippedSlot(35)).toBe(false))
	})

	describe('excluded mid-range flags', () => {
		it('excludes flag 5 (Cargo Hold)', () => expect(isEquippedSlot(5)).toBe(false))
		it('excludes flag 86 (below implant range)', () => expect(isEquippedSlot(86)).toBe(false))
		it('excludes flag 87 (Drone Bay)', () => expect(isEquippedSlot(87)).toBe(false))
		it('excludes flag 88 (between drone bay and implant)', () =>
			expect(isEquippedSlot(88)).toBe(false))
	})

	describe('Implant slot (89)', () => {
		it('includes flag 89 (Implant)', () => expect(isEquippedSlot(89)).toBe(true))
		it('excludes flag 90 (Ship Maintenance Bay)', () => expect(isEquippedSlot(90)).toBe(false))
		it('excludes flag 91 (not an equipped slot)', () => expect(isEquippedSlot(91)).toBe(false))
	})

	describe('Rig slots (92–99)', () => {
		it('includes flag 92 (RigSlot0)', () => expect(isEquippedSlot(92)).toBe(true))
		it('includes flag 95 (RigSlot3)', () => expect(isEquippedSlot(95)).toBe(true))
		it('includes flag 99 (RigSlot7)', () => expect(isEquippedSlot(99)).toBe(true))
		it('excludes flag 100 (above rig slots)', () => expect(isEquippedSlot(100)).toBe(false))
	})

	describe('gap between rigs and subsystems', () => {
		it('excludes flag 124 (below subsystem range)', () => expect(isEquippedSlot(124)).toBe(false))
	})

	describe('Subsystem slots (125–132)', () => {
		it('includes flag 125 (SubSystemSlot0)', () => expect(isEquippedSlot(125)).toBe(true))
		it('includes flag 128 (SubSystemSlot3)', () => expect(isEquippedSlot(128)).toBe(true))
		it('includes flag 132 (SubSystemSlot7)', () => expect(isEquippedSlot(132)).toBe(true))
		it('excludes flag 133 (above subsystem slots)', () => expect(isEquippedSlot(133)).toBe(false))
	})

	describe('Fighter Bay', () => {
		it('excludes flag 157 (below fighter bay)', () => expect(isEquippedSlot(157)).toBe(false))
		it('excludes flag 158 (Fighter Bay)', () => expect(isEquippedSlot(158)).toBe(false))
		it('excludes flag 159 (above fighter bay)', () => expect(isEquippedSlot(159)).toBe(false))
	})
})

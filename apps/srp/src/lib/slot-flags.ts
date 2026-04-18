/**
 * Returns true for item flags corresponding to equipped hull slots or implant slots.
 *
 * Included ranges (everything fitted to the hull or pod):
 *   Low Slots:   11–18  (LoSlot0–LoSlot7)
 *   Mid Slots:   19–26  (MedSlot0–MedSlot7)
 *   High Slots:  27–34  (HiSlot0–HiSlot7)
 *   Implants:    89     (ImplantSlot0 through single flag)
 *   Rig Slots:   92–99  (RigSlot0–RigSlot7)
 *   Subsystems:  125–132 (SubSystemSlot0–SubSystemSlot7, T3 hulls)
 *
 * Excluded (cargo / bay / fighters):
 *   5   → Cargo Hold
 *   87  → Drone Bay
 *   158 → Fighter Bay
 */
export function isEquippedSlot(flag: number): boolean {
	return (
		(flag >= 11 && flag <= 34) || // Low + Mid + High slots
		(flag >= 89 && flag <= 99) || // Implants (89) + Rig slots (92–99)
		(flag >= 125 && flag <= 132) // Subsystems (T3)
	)
}

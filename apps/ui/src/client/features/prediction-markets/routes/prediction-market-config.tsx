import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useConfirmationDialog } from '@/hooks/useConfirmationDialog'
import { usePageTitle } from '@/hooks/usePageTitle'
import toast from '@/lib/toast'

import { getThresholdImpact } from '../api'
import { useConfig, useUpdateConfig } from '../hooks'

const digitsOnly = (v: string) => v.replace(/\D/g, '')
const bps = (n: number) => `${(n / 100).toFixed(n % 100 === 0 ? 0 : 2)}%`

export default function PredictionMarketConfig() {
	usePageTitle('Admin - Prediction Market Config')

	const { data, isLoading, error } = useConfig()
	const update = useUpdateConfig()
	const { requestConfirmation, confirmationDialog } = useConfirmationDialog()

	const [rakeBps, setRakeBps] = useState('')
	const [minStake, setMinStake] = useState('')
	const [twoOfNEnabled, setTwoOfNEnabled] = useState(false)
	const [threshold, setThreshold] = useState('')
	const [changeNote, setChangeNote] = useState('')

	// Prefill from the TRUTHFUL runtime values getConfig reports (rake 0 on an unseeded table) — never
	// a "suggested" seed, so an untouched Save is a genuine no-op and the fields never lie about
	// current behavior.
	useEffect(() => {
		if (!data) return
		setRakeBps(String(data.defaultRakeBps))
		setMinStake(data.defaultMinStake)
		setTwoOfNEnabled(data.twoOfNThreshold !== null)
		setThreshold(data.twoOfNThreshold ?? '')
		setChangeNote('')
	}, [data])

	const busy = update.isPending

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()
		if (!data) return

		const rake = Number(rakeBps)
		if (!Number.isInteger(rake) || rake < 0 || rake > 2000) {
			toast.error('Rake must be a whole number of basis points between 0 and 2000 (0–20%).')
			return
		}
		if (!/^\d+$/.test(minStake) || BigInt(minStake) <= 0n) {
			toast.error('Minimum stake must be a positive whole number.')
			return
		}
		const candidate = twoOfNEnabled && threshold.trim() !== '' ? threshold.trim() : null
		if (candidate !== null && BigInt(candidate) <= 0n) {
			toast.error('Two-of-N threshold must be a positive whole number, or disable it.')
			return
		}

		const body = {
			defaultRakeBps: rake,
			defaultMinStake: minStake,
			twoOfNThreshold: candidate,
			changeNote: changeNote.trim() || undefined,
		}
		const submit = async () => {
			await update.mutateAsync(body)
		}

		const thresholdChanged = candidate !== data.twoOfNThreshold
		const rakeChanged = rake !== data.defaultRakeBps

		// A threshold change is read at SETTLE time — retroactive on existing markets. Fetch the exact
		// impact; hard-block if it would strand a single-resolver market (the server enforces this too).
		if (thresholdChanged) {
			let impact
			try {
				impact = await getThresholdImpact(candidate)
			} catch {
				toast.error('Could not compute the threshold impact — try again.')
				return
			}
			if (impact.strandedCandidates.length > 0) {
				const names = impact.strandedCandidates.map((s) => `“${s.question}”`).join(', ')
				toast.error(
					`Blocked: ${impact.strandedCandidates.length} market(s) would become unsettleable ` +
						`(a lone designated resolver can't reach two-of-N): ${names}. ` +
						`Resolve/void them or widen their resolver set, then retry.`
				)
				return
			}
			requestConfirmation({
				title: 'Change the two-of-N threshold?',
				description:
					`This is read at settlement time, so it retroactively re-evaluates existing markets: ` +
					`${impact.newlyRequiringCount} will newly require two-of-N and ` +
					`${impact.noLongerRequiringCount} will no longer.` +
					(rakeChanged
						? ` New-market rake also changes to ${bps(rake)} (was ${bps(data.defaultRakeBps)}).`
						: '') +
					` Continue?`,
				confirmLabel: 'Apply',
				cancelLabel: 'Cancel',
				intent: 'destructive',
				confirmButtonVariant: 'danger',
				confirmDelaySeconds: 5,
				onConfirm: submit,
			})
			return
		}

		// Rake affects the economics of every future market — confirm even without a threshold change.
		if (rakeChanged) {
			requestConfirmation({
				title: 'Change the default rake?',
				description:
					`New markets will take ${bps(rake)} rake (was ${bps(data.defaultRakeBps)}). ` +
					`Existing markets keep their frozen rake. Continue?`,
				confirmLabel: 'Apply',
				cancelLabel: 'Cancel',
				intent: 'destructive',
				confirmButtonVariant: 'danger',
				confirmDelaySeconds: 5,
				onConfirm: submit,
			})
			return
		}

		// Only min-stake changed (or nothing) — no retroactive/economic footgun; save directly.
		await submit()
	}

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-3xl font-bold gradient-text">Prediction Market Config</h1>
				<p className="mt-1 text-muted-foreground">
					Defaults applied to new markets, plus the pool threshold that triggers two-of-N
					settlement.
				</p>
			</div>

			{error ? (
				<p className="text-sm text-destructive">
					Failed to load config: {(error as Error).message}
				</p>
			) : null}

			{data && !data.configured ? (
				<div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
					No active config yet — new markets currently take <strong>0% rake</strong>, a{' '}
					<strong>minimum stake of 1</strong>, and <strong>two-of-N disabled</strong>. Saving writes
					the values below as the active defaults.
				</div>
			) : null}

			<form onSubmit={handleSubmit} className="space-y-6">
				<section className="space-y-4 rounded-md border border-border p-4">
					<div>
						<h2 className="text-lg font-semibold">Market defaults</h2>
						<p className="text-sm text-muted-foreground">
							Applied when a market is created and frozen onto it — changes affect new markets only.
						</p>
					</div>

					<div className="space-y-2">
						<Label htmlFor="pm-cfg-rake">Default rake (basis points)</Label>
						<Input
							id="pm-cfg-rake"
							type="text"
							inputMode="numeric"
							pattern="\d*"
							placeholder="100"
							value={rakeBps}
							onChange={(e) => setRakeBps(digitsOnly(e.target.value))}
							disabled={busy || isLoading}
						/>
						<p className="text-xs text-muted-foreground">
							0–2000 bps (0–20%). {rakeBps !== '' ? `= ${bps(Number(rakeBps) || 0)}` : null}
						</p>
					</div>

					<div className="space-y-2">
						<Label htmlFor="pm-cfg-min">Default minimum stake</Label>
						<Input
							id="pm-cfg-min"
							type="text"
							inputMode="numeric"
							pattern="\d*"
							placeholder="1"
							value={minStake}
							onChange={(e) => setMinStake(digitsOnly(e.target.value))}
							disabled={busy || isLoading}
						/>
						<p className="text-xs text-muted-foreground">Whole points only.</p>
					</div>
				</section>

				<section className="space-y-4 rounded-md border border-border p-4">
					<div className="flex items-center justify-between gap-4">
						<div>
							<h2 className="text-lg font-semibold">Two-of-N settlement threshold</h2>
							<p className="text-sm text-muted-foreground">
								Markets whose pool reaches this require a second distinct resolver to settle. Read
								at settlement time —{' '}
								<strong>changing it retroactively affects existing markets</strong>.
							</p>
						</div>
						<Switch
							checked={twoOfNEnabled}
							onCheckedChange={setTwoOfNEnabled}
							disabled={busy || isLoading}
							aria-label="Enable pool two-of-N"
						/>
					</div>

					{twoOfNEnabled ? (
						<div className="space-y-2">
							<Label htmlFor="pm-cfg-threshold">Pool threshold</Label>
							<Input
								id="pm-cfg-threshold"
								type="text"
								inputMode="numeric"
								pattern="\d*"
								placeholder="5000"
								value={threshold}
								onChange={(e) => setThreshold(digitsOnly(e.target.value))}
								disabled={busy || isLoading}
							/>
							<p className="text-xs text-muted-foreground">
								Whole points. Turn the switch off to disable.
							</p>
						</div>
					) : (
						<p className="text-sm text-muted-foreground">
							Disabled — no market requires two-of-N by pool size.
						</p>
					)}
				</section>

				<section className="space-y-2 rounded-md border border-border p-4">
					<Label htmlFor="pm-cfg-note">Change note (optional)</Label>
					<Textarea
						id="pm-cfg-note"
						placeholder="Why is this changing? (recorded in the config audit history)"
						value={changeNote}
						onChange={(e) => setChangeNote(e.target.value)}
						rows={2}
						maxLength={500}
						disabled={busy || isLoading}
					/>
				</section>

				<div className="flex justify-end">
					<Button
						type="submit"
						variant="primary"
						loading={busy}
						loadingText="Saving…"
						disabled={isLoading}
					>
						Save configuration
					</Button>
				</div>
			</form>

			{confirmationDialog}
		</div>
	)
}

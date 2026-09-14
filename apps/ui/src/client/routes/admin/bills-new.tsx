import { ArrowLeft } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'

import { BillEntityPicker } from '@/components/bills/bill-entity-picker'
import { BillFeedback } from '@/components/bills/bill-feedback'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NumberInput } from '@/components/ui/number-input'
import { PageHeader } from '@/components/ui/page-header'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
	useBillEntitySearch,
	useCreateBill,
	useCreateIssuedBill,
	useIssuerBillScope,
} from '@/hooks/useBills'
import { useDebounce } from '@/hooks/useDebounce'
import { usePageTitle } from '@/hooks/usePageTitle'
import { formatNumber, useAppTranslation } from '@/i18n'
import toast from '@/lib/toast'

import type { FormEvent } from 'react'
import type {
	Bill,
	CreateBillInput,
	EntityType,
	LateFeeCompounding,
	LateFeeType,
	PayeeType,
} from '@repo/bills'
import type { AppTranslationKey, AppTranslator } from '@/i18n'

export default function AdminBillsNewPage() {
	const { t } = useAppTranslation()
	const location = useLocation()
	const navigate = useNavigate()
	const isIssuerRoute = location.pathname === '/bills/issue'
	const issuerScope = useIssuerBillScope(isIssuerRoute)
	const issuerIsUnrestricted = issuerScope.data?.unrestricted === true
	const isScopedIssuer = isIssuerRoute && issuerScope.isSuccess && !issuerIsUnrestricted
	const scopedCorporationOptions = (issuerScope.data?.corporations ?? []).map((corporation) => ({
		value: corporation.corporationId,
		label: corporation.name,
		description: corporation.corporationId,
	}))
	usePageTitle(isIssuerRoute ? t('bills.actions.create') : 'Admin - Create Bill')

	const adminCreateBill = useCreateBill()
	const issuerCreateBill = useCreateIssuedBill()
	const createBill = isIssuerRoute ? issuerCreateBill : adminCreateBill

	const [formData, setFormData] = useState<{
		payerId: string
		payerType: EntityType
		payeeId: string
		payeeType: PayeeType
		title: string
		description: string
		amount: string
		dueDate: string
		enableLateFee: boolean
		lateFeeType: LateFeeType
		lateFeeAmount: string
		lateFeeCompounding: LateFeeCompounding
	}>({
		payerId: '',
		payerType: 'character',
		payeeId: '',
		payeeType: 'character',
		title: '',
		description: '',
		amount: '',
		dueDate: '',
		enableLateFee: false,
		lateFeeType: 'static',
		lateFeeAmount: '',
		lateFeeCompounding: 'none',
	})

	const [groupBillOptions, setGroupBillOptions] = useState({
		includeOwner: true,
		includeAdmins: true,
		includeMembers: true,
	})

	const [errors, setErrors] = useState<Record<string, AppTranslationKey>>({})
	const [message, setMessage] = useState<{
		type: 'success' | 'error'
		text: string | ((t: AppTranslator) => string)
	} | null>(null)
	const [payerQuery, setPayerQuery] = useState('')
	const [payeeQuery, setPayeeQuery] = useState('')
	const [payerName, setPayerName] = useState('')
	const [payeeName, setPayeeName] = useState('')
	const debouncedPayerQuery = useDebounce(payerQuery, 300)
	const debouncedPayeeQuery = useDebounce(payeeQuery, 300)
	const payerEntitySearch = useBillEntitySearch({
		q: debouncedPayerQuery,
		entityType: formData.payerType,
		scope: isIssuerRoute ? 'issuer' : 'admin',
		enabled: debouncedPayerQuery.trim().length >= 2,
	})
	const payeeEntitySearch = useBillEntitySearch({
		q: debouncedPayeeQuery,
		entityType: formData.payeeType,
		scope: isIssuerRoute ? 'issuer' : 'admin',
		enabled: debouncedPayeeQuery.trim().length >= 2,
	})
	const payerOptions = useMemo(() => {
		const deduped = new Map<string, { value: string; label: string; description: string }>()
		for (const row of payerEntitySearch.data ?? []) {
			const key = row.entityId
			if (!deduped.has(key)) {
				deduped.set(key, {
					value: row.entityId,
					label: row.name || row.entityId,
					description: row.entityId,
				})
			}
		}
		return [...deduped.values()]
	}, [payerEntitySearch.data])
	const payeeOptions = useMemo(() => {
		const deduped = new Map<string, { value: string; label: string; description: string }>()
		for (const row of payeeEntitySearch.data ?? []) {
			const key = row.entityId
			if (!deduped.has(key)) {
				deduped.set(key, {
					value: row.entityId,
					label: row.name || row.entityId,
					description: row.entityId,
				})
			}
		}
		return [...deduped.values()]
	}, [payeeEntitySearch.data])

	const handleChange = (field: string, value: string | boolean) => {
		setFormData((prev) => ({ ...prev, [field]: value }))
		if (field === 'payerType') {
			setPayerQuery('')
			setPayerName('')
			setFormData((prev) => ({ ...prev, payerId: '' }))
		}
		if (field === 'payeeType') {
			setPayeeQuery('')
			setPayeeName('')
			setFormData((prev) => ({ ...prev, payeeId: '' }))
		}
		// Clear error when field is edited
		if (errors[field]) {
			setErrors((prev) => {
				const { [field]: _, ...rest } = prev
				return rest
			})
		}
		// Clear general message
		if (message) setMessage(null)
	}

	const validate = (): boolean => {
		const newErrors: Record<string, AppTranslationKey> = {}

		if (!formData.payerId.trim()) {
			newErrors.payerId = 'bills.form.payerRequired'
		}

		if (!formData.payeeId.trim()) {
			newErrors.payeeId = 'bills.form.payeeRequired'
		}

		if (!formData.title.trim()) {
			newErrors.title = 'bills.form.titleRequired'
		}

		if (!formData.amount.trim()) {
			newErrors.amount = 'bills.form.amountRequired'
		} else if (isNaN(Number(formData.amount)) || Number(formData.amount) <= 0) {
			newErrors.amount = 'bills.form.amountPositive'
		}

		if (!formData.dueDate) {
			newErrors.dueDate = 'bills.form.dueRequired'
		} else {
			// Append T00:00:00 so the date is interpreted as local midnight rather than UTC midnight.
			// Without this, new Date("2026-03-26") is UTC midnight which falls before local midnight
			// for users west of UTC, causing today's date to be incorrectly rejected.
			const dueDate = new Date(formData.dueDate + 'T00:00:00')
			const today = new Date()
			today.setHours(0, 0, 0, 0)
			if (dueDate < today) {
				newErrors.dueDate = 'bills.form.dueFuture'
			}
		}

		if (!isIssuerRoute && formData.payerType === 'group') {
			if (
				!groupBillOptions.includeOwner &&
				!groupBillOptions.includeAdmins &&
				!groupBillOptions.includeMembers
			) {
				newErrors.groupBillOptions = 'bills.form.rolesRequired'
			}
		}

		if (formData.enableLateFee) {
			if (!formData.lateFeeAmount.trim()) {
				newErrors.lateFeeAmount = 'bills.form.lateRequired'
			} else if (isNaN(Number(formData.lateFeeAmount)) || Number(formData.lateFeeAmount) <= 0) {
				newErrors.lateFeeAmount = 'bills.form.latePositive'
			} else if (formData.lateFeeType === 'percentage' && Number(formData.lateFeeAmount) > 100) {
				newErrors.lateFeeAmount = 'bills.form.lateMaximum'
			}
		}

		setErrors(newErrors)
		return Object.keys(newErrors).length === 0
	}

	const handleSubmit = async (e: FormEvent) => {
		e.preventDefault()

		if (!validate()) {
			return
		}

		try {
			const input: CreateBillInput & {
				groupBillOptions?: {
					includeOwner: boolean
					includeAdmins: boolean
					includeMembers: boolean
				}
			} = {
				payerId: formData.payerId.trim(),
				payerType: formData.payerType,
				payeeId: formData.payeeId.trim(),
				payeeType: formData.payeeType,
				title: formData.title.trim(),
				description: formData.description.trim() || undefined,
				amount: formData.amount.trim(),
				dueDate: new Date(formData.dueDate),
				lateFeeType: formData.enableLateFee ? formData.lateFeeType : 'none',
				lateFeeAmount:
					formData.enableLateFee && formData.lateFeeAmount.trim()
						? formData.lateFeeAmount.trim()
						: undefined,
				lateFeeCompounding:
					formData.enableLateFee && formData.lateFeeType !== 'none'
						? formData.lateFeeCompounding
						: undefined,
				...((!isIssuerRoute || issuerIsUnrestricted) &&
					formData.payerType === 'group' && { groupBillOptions }),
			}

			const result = await createBill.mutateAsync(input)

			// Group bill returns { groupBillId, bills, billCount }; navigate to group aggregate view
			if ('bills' in result) {
				const groupResult = result as { groupBillId: string; bills: Bill[]; billCount: number }
				setMessage({
					type: 'success',
					text: (t) =>
						t('bills.form.groupCreated', {
							count: groupResult.billCount,
							formattedCount: formatNumber(groupResult.billCount),
						}),
				})
				setTimeout(() => {
					void navigate(
						isIssuerRoute
							? '/my-bills'
							: `/admin/bills/group/${encodeURIComponent(groupResult.groupBillId)}`
					)
				}, 1500)
			} else {
				setMessage({ type: 'success', text: (t) => t('bills.form.created') })
				setTimeout(() => {
					void navigate(isIssuerRoute ? '/my-bills' : '/admin/bills')
				}, 1500)
			}
		} catch (error) {
			toast.error(
				error instanceof Error ? (
					error.message
				) : (
					<BillFeedback messageKey="bills.form.createFailed" />
				)
			)
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : (t) => t('bills.form.createFailed'),
			})
		}
	}

	return (
		<div className="space-y-6">
			<PageHeader
				title={t('bills.actions.create')}
				description={
					isIssuerRoute
						? t('bills.form.description')
						: 'Create a new bill for a character, corporation, or group'
				}
				action={
					<Button variant="ghost" asChild>
						<Link to={isIssuerRoute ? '/my-bills' : '/admin/bills'}>
							<ArrowLeft className="h-4 w-4" />
							{t('bills.back')}
						</Link>
					</Button>
				}
			/>

			{/* Success/Error Message */}
			{message && (
				<Card
					className={
						message.type === 'error'
							? 'border-destructive bg-destructive/10'
							: 'border-primary bg-primary/10'
					}
				>
					<CardContent className="py-3">
						<p className={message.type === 'error' ? 'text-destructive' : 'text-primary'}>
							{typeof message.text === 'function' ? message.text(t) : message.text}
						</p>
					</CardContent>
				</Card>
			)}

			<form onSubmit={handleSubmit}>
				{/* Payer Information */}
				<Card className="mb-6">
					<CardHeader>
						<CardTitle>{t('bills.form.payerTitle')}</CardTitle>
						<CardDescription>{t('bills.form.payerDescription')}</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<BillEntityPicker
							roleLabel={t('bills.columns.payer')}
							typeFieldId="payerType"
							entityFieldId="payerId"
							entityType={formData.payerType}
							allowedEntityTypes={
								isIssuerRoute && !issuerIsUnrestricted
									? ['character']
									: ['character', 'corporation', 'group']
							}
							onEntityTypeChange={(value) => handleChange('payerType', value)}
							query={payerQuery}
							onQueryChange={setPayerQuery}
							options={payerOptions}
							onEntitySelect={(entityId, name) => {
								handleChange('payerId', entityId)
								setPayerName(name)
							}}
							loading={payerEntitySearch.isLoading}
							selectedEntityId={formData.payerId}
							selectedEntityName={payerName}
							error={errors.payerId ? t(errors.payerId) : undefined}
						/>
					</CardContent>
				</Card>

				{/* Group Bill Options — shown only when payer type is group */}
				{(!isIssuerRoute || issuerIsUnrestricted) && formData.payerType === 'group' && (
					<Card className="mb-6">
						<CardHeader>
							<CardTitle>{t('bills.form.rolesTitle')}</CardTitle>
							<CardDescription>{t('bills.form.rolesDescription')}</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="flex items-center justify-between">
								<div className="space-y-0.5">
									<Label htmlFor="includeOwner">{t('bills.form.includeOwner')}</Label>
									<p className="text-sm text-muted-foreground">{t('bills.form.ownerHint')}</p>
								</div>
								<Switch
									id="includeOwner"
									checked={groupBillOptions.includeOwner}
									onCheckedChange={(checked) =>
										setGroupBillOptions((prev) => ({ ...prev, includeOwner: checked }))
									}
								/>
							</div>
							<div className="flex items-center justify-between">
								<div className="space-y-0.5">
									<Label htmlFor="includeAdmins">{t('bills.form.includeAdmins')}</Label>
									<p className="text-sm text-muted-foreground">{t('bills.form.adminsHint')}</p>
								</div>
								<Switch
									id="includeAdmins"
									checked={groupBillOptions.includeAdmins}
									onCheckedChange={(checked) =>
										setGroupBillOptions((prev) => ({ ...prev, includeAdmins: checked }))
									}
								/>
							</div>
							<div className="flex items-center justify-between">
								<div className="space-y-0.5">
									<Label htmlFor="includeMembers">{t('bills.form.includeMembers')}</Label>
									<p className="text-sm text-muted-foreground">{t('bills.form.membersHint')}</p>
								</div>
								<Switch
									id="includeMembers"
									checked={groupBillOptions.includeMembers}
									onCheckedChange={(checked) =>
										setGroupBillOptions((prev) => ({ ...prev, includeMembers: checked }))
									}
								/>
							</div>
							{errors.groupBillOptions && (
								<p className="text-sm text-destructive">{t(errors.groupBillOptions)}</p>
							)}
						</CardContent>
					</Card>
				)}

				{/* Payee Information */}
				<Card className="mb-6">
					<CardHeader>
						<CardTitle>{t('bills.form.payeeTitle')}</CardTitle>
						<CardDescription>{t('bills.form.payeeDescription')}</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<BillEntityPicker
							roleLabel={t('bills.columns.payee')}
							typeFieldId="payeeType"
							entityFieldId="payeeId"
							entityType={formData.payeeType}
							allowedEntityTypes={['character', 'corporation']}
							onEntityTypeChange={(value) => handleChange('payeeType', value)}
							query={payeeQuery}
							onQueryChange={setPayeeQuery}
							options={payeeOptions}
							onEntitySelect={(entityId, name) => {
								handleChange('payeeId', entityId)
								setPayeeName(name)
							}}
							loading={payeeEntitySearch.isLoading}
							selectedEntityId={formData.payeeId}
							selectedEntityName={payeeName}
							error={errors.payeeId ? t(errors.payeeId) : undefined}
							staticOptions={
								isScopedIssuer && formData.payeeType === 'corporation'
									? scopedCorporationOptions
									: undefined
							}
						/>
					</CardContent>
				</Card>

				{/* Bill Details */}
				<Card className="mb-6">
					<CardHeader>
						<CardTitle>{t('bills.details')}</CardTitle>
						<CardDescription>{t('bills.form.detailsDescription')}</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="title">
								{t('bills.columns.title')} <span className="text-destructive">*</span>
							</Label>
							<Input
								id="title"
								placeholder={t('bills.form.titlePlaceholder')}
								value={formData.title}
								onChange={(e) => handleChange('title', e.target.value)}
								className={errors.title ? 'border-destructive' : ''}
							/>
							{errors.title && <p className="text-sm text-destructive">{t(errors.title)}</p>}
						</div>

						<div className="space-y-2">
							<Label htmlFor="description">{t('bills.columns.description')}</Label>
							<Textarea
								id="description"
								placeholder={t('bills.form.descriptionPlaceholder')}
								rows={3}
								value={formData.description}
								onChange={(e) => handleChange('description', e.target.value)}
							/>
							<p className="text-sm text-muted-foreground">{t('bills.form.descriptionHint')}</p>
						</div>

						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							<div className="space-y-2">
								<Label htmlFor="amount">
									{t('bills.form.amount')} <span className="text-destructive">*</span>
								</Label>
								<NumberInput
									id="amount"
									min={0}
									suffix=" ISK"
									placeholder="1,000,000 ISK"
									value={formData.amount}
									onChange={(value) => handleChange('amount', value)}
									error={!!errors.amount}
								/>
								{errors.amount && <p className="text-sm text-destructive">{t(errors.amount)}</p>}
							</div>

							<div className="space-y-2">
								<Label htmlFor="dueDate">
									{t('bills.columns.dueDate')} <span className="text-destructive">*</span>
								</Label>
								<Input
									id="dueDate"
									type="date"
									value={formData.dueDate}
									onChange={(e) => handleChange('dueDate', e.target.value)}
									className={errors.dueDate ? 'border-destructive' : ''}
								/>
								{errors.dueDate && <p className="text-sm text-destructive">{t(errors.dueDate)}</p>}
							</div>
						</div>
					</CardContent>
				</Card>

				{/* Late Fee Settings */}
				<Card className="mb-6">
					<CardHeader>
						<CardTitle>{t('bills.form.lateTitle')}</CardTitle>
						<CardDescription>{t('bills.form.lateDescription')}</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="flex items-center justify-between">
							<div className="space-y-0.5">
								<Label htmlFor="enableLateFee">{t('bills.form.lateEnable')}</Label>
								<p className="text-sm text-muted-foreground">{t('bills.form.lateHint')}</p>
							</div>
							<Switch
								id="enableLateFee"
								checked={formData.enableLateFee}
								onCheckedChange={(checked) => handleChange('enableLateFee', checked)}
							/>
						</div>

						{formData.enableLateFee && (
							<>
								<div className="space-y-2">
									<Label htmlFor="lateFeeType">{t('bills.late.type')}</Label>
									<Select
										inputId="lateFeeType"
										value={formData.lateFeeType}
										onValueChange={(value) => handleChange('lateFeeType', value)}
										options={[
											{ value: 'static', label: t('bills.form.lateStatic') },
											{ value: 'percentage', label: t('bills.form.latePercentage') },
										]}
									/>
								</div>

								<div className="space-y-2">
									<Label htmlFor="lateFeeAmount">
										{t('bills.form.lateAmount', {
											unit: formData.lateFeeType === 'percentage' ? '%' : 'ISK',
										})}{' '}
										<span className="text-destructive">*</span>
									</Label>
									{formData.lateFeeType === 'percentage' ? (
										<NumberInput
											id="lateFeeAmount"
											min={0}
											max={100}
											decimalScale={2}
											fixedDecimalScale
											suffix="%"
											placeholder="5.00"
											value={formData.lateFeeAmount}
											onChange={(value) => handleChange('lateFeeAmount', value)}
											error={!!errors.lateFeeAmount}
										/>
									) : (
										<NumberInput
											id="lateFeeAmount"
											min={0}
											suffix=" ISK"
											placeholder="1,000,000 ISK"
											value={formData.lateFeeAmount}
											onChange={(value) => handleChange('lateFeeAmount', value)}
											error={!!errors.lateFeeAmount}
										/>
									)}
									{errors.lateFeeAmount && (
										<p className="text-sm text-destructive">
											{t(errors.lateFeeAmount, {
												maximum: formatNumber(1, {
													style: 'percent',
													minimumFractionDigits: 2,
													maximumFractionDigits: 2,
												}),
											})}
										</p>
									)}
								</div>

								<div className="space-y-2">
									<Label htmlFor="lateFeeCompounding">{t('bills.form.lateCompounding')}</Label>
									<Select
										inputId="lateFeeCompounding"
										value={formData.lateFeeCompounding}
										onValueChange={(value) => handleChange('lateFeeCompounding', value)}
										options={[
											{ value: 'none', label: t('bills.form.lateNone') },
											{ value: 'daily', label: t('bills.form.lateDaily') },
											{ value: 'weekly', label: t('bills.form.lateWeekly') },
											{ value: 'monthly', label: t('bills.form.lateMonthly') },
										]}
									/>
									<p className="text-sm text-muted-foreground">{t('bills.form.lateFrequency')}</p>
								</div>
							</>
						)}
					</CardContent>
				</Card>

				{/* Actions */}
				<div className="flex gap-3">
					<Button variant="confirm" type="submit" loading={createBill.isPending}>
						{t('bills.actions.create')}
					</Button>
					<Button
						variant="cancel"
						type="button"
						onClick={() => navigate(isIssuerRoute ? '/my-bills' : '/admin/bills')}
					>
						{t('common.cancel')}
					</Button>
				</div>
			</form>
		</div>
	)
}

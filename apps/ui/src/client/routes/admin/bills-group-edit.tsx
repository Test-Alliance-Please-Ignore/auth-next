import { ArrowLeft, Users } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NumberInput } from '@/components/ui/number-input'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useGroupBillAggregate, useUpdateGroupBill } from '@/hooks/useBills'
import { usePageTitle } from '@/hooks/usePageTitle'
import { formatNumber, useAppTranslation } from '@/i18n'

import type { FormEvent } from 'react'
import type { LateFeeCompounding, LateFeeType, UpdateBillInput } from '@repo/bills'
import type { AppTranslationKey, AppTranslator } from '@/i18n'
import type { GroupBillAccessScope } from '@/lib/bills-api'

export default function AdminBillsGroupEditPage({
	scope = 'admin',
}: {
	scope?: GroupBillAccessScope
}) {
	const { t } = useAppTranslation()
	const { groupBillId } = useParams<{ groupBillId: string }>()
	const navigate = useNavigate()

	const { data: aggregate, isLoading, error } = useGroupBillAggregate(groupBillId, scope)
	const updateGroupBill = useUpdateGroupBill(scope)
	const basePath = scope === 'issuer' ? '/my-bills' : '/admin/bills'

	usePageTitle(
		aggregate ? t('bills.group.editPageTitle', { title: aggregate.title }) : t('bills.group.edit')
	)

	const [formData, setFormData] = useState<{
		title: string
		description: string
		amount: string
		dueDate: string
		enableLateFee: boolean
		lateFeeType: LateFeeType
		lateFeeAmount: string
		lateFeeCompounding: LateFeeCompounding
	}>({
		title: '',
		description: '',
		amount: '',
		dueDate: '',
		enableLateFee: false,
		lateFeeType: 'static',
		lateFeeAmount: '',
		lateFeeCompounding: 'none',
	})

	const [errors, setErrors] = useState<Record<string, AppTranslationKey>>({})
	const [message, setMessage] = useState<{
		type: 'success' | 'error'
		text: string | ((t: AppTranslator) => string)
	} | null>(null)

	const handleChange = (field: string, value: string | boolean) => {
		setFormData((prev) => ({ ...prev, [field]: value }))
		if (errors[field]) {
			setErrors((prev) => {
				const { [field]: _, ...rest } = prev
				return rest
			})
		}
		if (message) setMessage(null)
	}

	const validate = (): boolean => {
		const newErrors: Record<string, AppTranslationKey> = {}

		if (
			formData.amount.trim() &&
			(isNaN(Number(formData.amount)) || Number(formData.amount) <= 0)
		) {
			newErrors.amount = 'bills.form.amountPositive'
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
		if (!validate()) return

		// Only include fields that were filled in — blank fields are omitted
		const input: UpdateBillInput = {}
		if (formData.title.trim()) input.title = formData.title.trim()
		if (formData.description.trim()) input.description = formData.description.trim()
		if (formData.amount.trim()) input.amount = formData.amount.trim()
		if (formData.dueDate) input.dueDate = new Date(formData.dueDate + 'T00:00:00')
		if (formData.enableLateFee) {
			input.lateFeeType = formData.lateFeeType
			if (formData.lateFeeAmount.trim()) input.lateFeeAmount = formData.lateFeeAmount.trim()
			if (formData.lateFeeType !== 'none') input.lateFeeCompounding = formData.lateFeeCompounding
		}

		if (Object.keys(input).length === 0) {
			setMessage({ type: 'error', text: (t) => t('bills.group.noChanges') })
			return
		}

		try {
			const result = await updateGroupBill.mutateAsync({ groupBillId: groupBillId!, data: input })
			setMessage({
				type: 'success',
				text: (t) =>
					t(result.skipped > 0 ? 'bills.group.updatedSkipped' : 'bills.group.updated', {
						count: result.succeeded,
						formattedCount: formatNumber(result.succeeded),
						skipped: formatNumber(result.skipped),
					}),
			})
			setTimeout(() => {
				void navigate(basePath)
			}, 1500)
		} catch (err) {
			setMessage({
				type: 'error',
				text: err instanceof Error ? err.message : (t) => t('bills.group.updateFailed'),
			})
		}
	}

	if (isLoading) {
		return (
			<div className="space-y-6">
				<div className="flex flex-col items-start justify-between gap-4 sm:flex-row">
					<h1 className="text-3xl font-bold gradient-text">{t('common.loading')}</h1>
					<Button variant="ghost" asChild>
						<Link to={basePath}>
							<ArrowLeft className="h-4 w-4" />
							{t('bills.back')}
						</Link>
					</Button>
				</div>
			</div>
		)
	}

	if (error || !aggregate) {
		return (
			<div className="space-y-6">
				<div className="flex flex-col items-start justify-between gap-4 sm:flex-row">
					<div>
						<h1 className="text-3xl font-bold gradient-text">{t('bills.group.notFound')}</h1>
						<p className="text-muted-foreground mt-2">{t('bills.group.unavailable')}</p>
					</div>
					<Button variant="ghost" asChild>
						<Link to={basePath}>
							<ArrowLeft className="h-4 w-4" />
							{t('bills.back')}
						</Link>
					</Button>
				</div>
			</div>
		)
	}

	const eligibleCount = aggregate.bills.filter(
		(b) => b.status !== 'paid' && b.status !== 'cancelled'
	).length

	return (
		<div className="space-y-6">
			<div className="flex flex-col items-start justify-between gap-4 sm:flex-row">
				<div>
					<h1 className="text-3xl font-bold gradient-text">{t('bills.group.edit')}</h1>
					<p className="text-muted-foreground mt-2 flex items-center gap-2">
						<Users className="h-4 w-4" />
						{t('bills.group.eligible', {
							title: aggregate.title,
							count: eligibleCount,
							formattedCount: formatNumber(eligibleCount),
						})}
					</p>
				</div>
				<Button variant="ghost" asChild>
					<Link to={basePath}>
						<ArrowLeft className="h-4 w-4" />
						{t('bills.back')}
					</Link>
				</Button>
			</div>

			<Card className="border-muted bg-muted/20">
				<CardContent className="py-3 text-sm text-muted-foreground">
					{t('bills.group.editHint')}
				</CardContent>
			</Card>

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
				<Card className="mb-6">
					<CardHeader>
						<CardTitle>{t('bills.details')}</CardTitle>
						<CardDescription>{t('bills.group.keepValues')}</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="title">{t('bills.columns.title')}</Label>
							<Input
								id="title"
								placeholder={t('bills.group.keepTitle')}
								value={formData.title}
								onChange={(e) => handleChange('title', e.target.value)}
							/>
						</div>

						<div className="space-y-2">
							<Label htmlFor="description">{t('bills.columns.description')}</Label>
							<Textarea
								id="description"
								rows={3}
								placeholder={t('bills.group.keepDescription')}
								value={formData.description}
								onChange={(e) => handleChange('description', e.target.value)}
							/>
						</div>

						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							<div className="space-y-2">
								<Label htmlFor="amount">{t('bills.form.amount')}</Label>
								<NumberInput
									id="amount"
									min={0}
									suffix=" ISK"
									placeholder={t('bills.group.keepAmount')}
									value={formData.amount}
									onChange={(value) => handleChange('amount', value)}
									error={!!errors.amount}
								/>
								{errors.amount && <p className="text-sm text-destructive">{t(errors.amount)}</p>}
							</div>

							<div className="space-y-2">
								<Label htmlFor="dueDate">{t('bills.columns.dueDate')}</Label>
								<Input
									id="dueDate"
									type="date"
									value={formData.dueDate}
									onChange={(e) => handleChange('dueDate', e.target.value)}
								/>
							</div>
						</div>
					</CardContent>
				</Card>

				<Card className="mb-6">
					<CardHeader>
						<CardTitle>{t('bills.form.lateTitle')}</CardTitle>
						<CardDescription>{t('bills.group.lateDescription')}</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="flex items-center justify-between">
							<div className="space-y-0.5">
								<Label htmlFor="enableLateFee">{t('bills.group.lateUpdate')}</Label>
								<p className="text-sm text-muted-foreground">{t('bills.group.lateDescription')}</p>
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
											value={formData.lateFeeAmount}
											onChange={(value) => handleChange('lateFeeAmount', value)}
											error={!!errors.lateFeeAmount}
										/>
									) : (
										<NumberInput
											id="lateFeeAmount"
											min={0}
											suffix=" ISK"
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
								</div>
							</>
						)}
					</CardContent>
				</Card>

				<div className="flex flex-wrap gap-3">
					<Button
						variant="confirm"
						type="submit"
						loading={updateGroupBill.isPending}
						className="h-auto min-h-10 whitespace-normal"
					>
						{t('bills.group.apply')}
					</Button>
					<Button variant="cancel" type="button" onClick={() => navigate(basePath)}>
						{t('common.cancel')}
					</Button>
				</div>
			</form>
		</div>
	)
}

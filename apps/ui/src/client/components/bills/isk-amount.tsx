import { formatISK } from '@/lib/bills-utils'

interface ISKAmountProps {
	amount: string | number
	className?: string
}

export function ISKAmount({ amount, className }: ISKAmountProps) {
	return <span className={className}>{formatISK(amount)}</span>
}

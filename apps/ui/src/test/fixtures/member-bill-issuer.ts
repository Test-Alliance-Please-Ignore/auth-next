import { memberBill } from './member-bills'

import type { BillingIssuerScope, GroupBillAggregate } from '@repo/bills'

export const memberIssuerScope: BillingIssuerScope = {
	unrestricted: false,
	corporationIds: ['9007199254740993002'],
	corporations: [{ corporationId: '9007199254740993002', name: 'Original <Corporation>' }],
}

export const memberBillGroup: GroupBillAggregate = {
	groupBillId: 'group-original',
	groupId: 'group-payer-original',
	groupName: 'Original <Group>',
	issuerId: memberBill.issuerId,
	issuerName: 'Original <Issuer>',
	title: 'Original <Group Bill> — 원문',
	description: 'Original description <script>raw</script>',
	amount: memberBill.amount,
	dueDate: memberBill.dueDate,
	createdAt: memberBill.createdAt,
	totalBills: 1234,
	paidBills: 1000,
	bills: ['draft', 'issued', 'overdue', 'paid', 'cancelled'].map((status, index) => ({
		billId: `bill-${status}`,
		payerId: `900719925474099300${index}`,
		payerName: `Original <Member ${index}>`,
		status: status as GroupBillAggregate['bills'][number]['status'],
		amount: memberBill.amount,
		lateFee: '1.25',
		totalDue: '9007199254740994.37',
		totalPaid: status === 'issued' ? '1000.50' : '0',
		paidAt: status === 'paid' ? new Date('2026-09-13T10:30:00Z') : null,
		hasPayments: status === 'issued' || status === 'paid',
	})),
}

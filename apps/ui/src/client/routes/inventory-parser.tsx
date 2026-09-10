/**
 * Inventory Parser Page
 *
 * Utility page for parsing EVE Online inventory exports
 */

import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/ui/page-header'

import { InventoryParser } from '../components/inventory-parser'
import { usePageTitle } from '../hooks/usePageTitle'

export default function InventoryParserPage() {
	usePageTitle('Inventory Parser')

	return (
		<Container>
			<PageHeader
				title="Inventory Parser"
				description="Parse EVE Online inventory exports to view detailed item information"
			/>

			<InventoryParser />
		</Container>
	)
}

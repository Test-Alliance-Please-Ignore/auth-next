/**
 * Inventory Parser Page
 *
 * Utility page for parsing EVE Online inventory exports
 */

import { InventoryParser } from '../components/inventory-parser'
import { usePageTitle } from '../hooks/usePageTitle'

export default function InventoryParserPage() {
	usePageTitle('Inventory Parser')

	return (
		<div className="container py-8">
			<div className="mb-8">
				<h1 className="text-4xl font-bold gradient-text">Inventory Parser</h1>
				<p className="text-muted-foreground mt-2">
					Parse EVE Online inventory exports to view detailed item information
				</p>
			</div>

			<InventoryParser />
		</div>
	)
}

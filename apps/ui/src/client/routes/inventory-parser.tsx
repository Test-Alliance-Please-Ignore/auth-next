/**
 * Inventory Parser Page
 *
 * Utility page for parsing EVE Online inventory exports
 */

import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/ui/page-header'

import { InventoryParser } from '../components/inventory-parser'
import { usePageTitle } from '../hooks/usePageTitle'
import { useAppTranslation } from '../i18n'

export default function InventoryParserPage() {
	const { t } = useAppTranslation()
	usePageTitle(t('inventoryParser.title'))

	return (
		<Container>
			<PageHeader
				title={t('inventoryParser.title')}
				description={t('inventoryParser.description')}
			/>

			<InventoryParser />
		</Container>
	)
}

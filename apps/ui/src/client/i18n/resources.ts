import { adminCatalog } from './catalogs/admin'
import { applicationsCatalog } from './catalogs/applications'
import { billsCatalog } from './catalogs/bills'
import { broadcastsCatalog } from './catalogs/broadcasts'
import { charactersCorporationsCatalog } from './catalogs/characters-corporations'
import { commonCatalog } from './catalogs/common'
import { doctrinesCatalog } from './catalogs/doctrines'
import { fleetTrackingCatalog } from './catalogs/fleet-tracking'
import { freightIndustryCatalog } from './catalogs/freight-industry'
import { groupsCatalog } from './catalogs/groups'
import { hrCatalog } from './catalogs/hr'
import { moonScanCatalog } from './catalogs/moon-scan'
import { pasteMumbleCatalog } from './catalogs/paste-mumble'
import { predictionDkpCatalog } from './catalogs/prediction-dkp'
import { shellCatalog } from './catalogs/shell'
import { skillPlansCatalog } from './catalogs/skill-plans'
import { srpCatalog } from './catalogs/srp'
import { structuresCatalog } from './catalogs/structures'
import { taxCatalog } from './catalogs/tax'

import type { MessageShape } from './catalog'

export const en = {
	...commonCatalog.en,
	...shellCatalog.en,
	...groupsCatalog.en,
	...charactersCorporationsCatalog.en,
	...applicationsCatalog.en,
	...hrCatalog.en,
	...pasteMumbleCatalog.en,
	...broadcastsCatalog.en,
	...billsCatalog.en,
	...taxCatalog.en,
	...predictionDkpCatalog.en,
	...doctrinesCatalog.en,
	...srpCatalog.en,
	...freightIndustryCatalog.en,
	...moonScanCatalog.en,
	...skillPlansCatalog.en,
	...fleetTrackingCatalog.en,
	...structuresCatalog.en,
	...adminCatalog.en,
} as const

export const de = {
	...commonCatalog.de,
	...shellCatalog.de,
	...groupsCatalog.de,
	...charactersCorporationsCatalog.de,
	...applicationsCatalog.de,
	...hrCatalog.de,
	...pasteMumbleCatalog.de,
	...broadcastsCatalog.de,
	...billsCatalog.de,
	...taxCatalog.de,
	...predictionDkpCatalog.de,
	...doctrinesCatalog.de,
	...srpCatalog.de,
	...freightIndustryCatalog.de,
	...moonScanCatalog.de,
	...skillPlansCatalog.de,
	...fleetTrackingCatalog.de,
	...structuresCatalog.de,
	...adminCatalog.de,
} satisfies MessageShape<typeof en>

export const ko = {
	...commonCatalog.ko,
	...shellCatalog.ko,
	...groupsCatalog.ko,
	...charactersCorporationsCatalog.ko,
	...applicationsCatalog.ko,
	...hrCatalog.ko,
	...pasteMumbleCatalog.ko,
	...broadcastsCatalog.ko,
	...billsCatalog.ko,
	...taxCatalog.ko,
	...predictionDkpCatalog.ko,
	...doctrinesCatalog.ko,
	...srpCatalog.ko,
	...freightIndustryCatalog.ko,
	...moonScanCatalog.ko,
	...skillPlansCatalog.ko,
	...fleetTrackingCatalog.ko,
	...structuresCatalog.ko,
	...adminCatalog.ko,
} satisfies MessageShape<typeof en>

export const resources = {
	en: { translation: en },
	de: { translation: de },
	ko: { translation: ko },
} as const

type LeafPaths<Value, Prefix extends string = ''> = Value extends string
	? Prefix
	: {
			[Key in keyof Value & string]: LeafPaths<
				Value[Key],
				`${Prefix}${Prefix extends '' ? '' : '.'}${Key}`
			>
		}[keyof Value & string]

type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other'

type NormalizePluralKey<Key> = Key extends `${infer Base}_${PluralCategory}` ? Base : Key

export type AppTranslationKey = NormalizePluralKey<LeafPaths<typeof en>>

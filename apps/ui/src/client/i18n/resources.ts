import { adminCatalog } from './catalogs/admin'
import { applicationsCatalog } from './catalogs/applications'
import { billsCatalog } from './catalogs/bills'
import { broadcastsCatalog } from './catalogs/broadcasts'
import { characterpagesCatalog } from './catalogs/character-pages'
import { charactersCorporationsCatalog } from './catalogs/characters-corporations'
import { commonCatalog } from './catalogs/common'
import { doctrinesCatalog } from './catalogs/doctrines'
import { fleetTrackingCatalog } from './catalogs/fleet-tracking'
import { freightIndustryCatalog } from './catalogs/freight-industry'
import { groupsCatalog } from './catalogs/groups'
import { hrCatalog } from './catalogs/hr'
import { hrpagesCatalog } from './catalogs/hr-pages'
import { industryCatalog } from './catalogs/industry'
import { moonScanCatalog } from './catalogs/moon-scan'
import { pasteMumbleCatalog } from './catalogs/paste-mumble'
import { predictionDkpCatalog } from './catalogs/prediction-dkp'
import { shellCatalog } from './catalogs/shell'
import { skillPlansCatalog } from './catalogs/skill-plans'
import { srpCatalog } from './catalogs/srp'
import { structuresCatalog } from './catalogs/structures'
import { taxCatalog } from './catalogs/tax'

import type { MessageShape } from './catalog'
import type { AppLocale } from './locales'

export const en = {
	...commonCatalog.en,
	...shellCatalog.en,
	...groupsCatalog.en,
	...charactersCorporationsCatalog.en,
	...characterpagesCatalog.en,
	...applicationsCatalog.en,
	...hrCatalog.en,
	...hrpagesCatalog.en,
	...pasteMumbleCatalog.en,
	...broadcastsCatalog.en,
	...billsCatalog.en,
	...taxCatalog.en,
	...predictionDkpCatalog.en,
	...doctrinesCatalog.en,
	...srpCatalog.en,
	...freightIndustryCatalog.en,
	...industryCatalog.en,
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
	...characterpagesCatalog.de,
	...applicationsCatalog.de,
	...hrCatalog.de,
	...hrpagesCatalog.de,
	...pasteMumbleCatalog.de,
	...broadcastsCatalog.de,
	...billsCatalog.de,
	...taxCatalog.de,
	...predictionDkpCatalog.de,
	...doctrinesCatalog.de,
	...srpCatalog.de,
	...freightIndustryCatalog.de,
	...industryCatalog.de,
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
	...characterpagesCatalog.ko,
	...applicationsCatalog.ko,
	...hrCatalog.ko,
	...hrpagesCatalog.ko,
	...pasteMumbleCatalog.ko,
	...broadcastsCatalog.ko,
	...billsCatalog.ko,
	...taxCatalog.ko,
	...predictionDkpCatalog.ko,
	...doctrinesCatalog.ko,
	...srpCatalog.ko,
	...freightIndustryCatalog.ko,
	...industryCatalog.ko,
	...moonScanCatalog.ko,
	...skillPlansCatalog.ko,
	...fleetTrackingCatalog.ko,
	...structuresCatalog.ko,
	...adminCatalog.ko,
} satisfies MessageShape<typeof en>

export const esMX = {
	...commonCatalog['es-MX'],
	...shellCatalog['es-MX'],
	...groupsCatalog['es-MX'],
	...charactersCorporationsCatalog['es-MX'],
	...characterpagesCatalog['es-MX'],
	...applicationsCatalog['es-MX'],
	...hrCatalog['es-MX'],
	...hrpagesCatalog['es-MX'],
	...pasteMumbleCatalog['es-MX'],
	...broadcastsCatalog['es-MX'],
	...billsCatalog['es-MX'],
	...taxCatalog['es-MX'],
	...predictionDkpCatalog['es-MX'],
	...doctrinesCatalog['es-MX'],
	...srpCatalog['es-MX'],
	...freightIndustryCatalog['es-MX'],
	...industryCatalog['es-MX'],
	...moonScanCatalog['es-MX'],
	...skillPlansCatalog['es-MX'],
	...fleetTrackingCatalog['es-MX'],
	...structuresCatalog['es-MX'],
	...adminCatalog['es-MX'],
} satisfies MessageShape<typeof en, 'many'>

export const resources = {
	en: { translation: en },
	de: { translation: de },
	ko: { translation: ko },
	'es-MX': { translation: esMX },
} as const satisfies Record<AppLocale, { translation: MessageShape<typeof en> }>

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

/**
 * Alert Orchestrator
 *
 * Runs all alert processors against the report data and collects results.
 */

export { checkSpPlausibility } from './sp-plausibility'
export { checkShipNameCrossmatch, collectCustomShipNames, extractCandidateCharacterNames } from './ship-name-crossmatch'
export { checkPlexInjectorTrading } from './plex-injector-trading'
export { checkLargeIskTransfer } from './large-isk-transfer'
export { checkDataFetchFailures } from './data-fetch-failure'
export { checkCorpHopper } from './corp-hopper'
export type { ReportAlert, ReportAlerts, AlertSeverity, AlertType } from './types'
export type { ResolvedCharacter } from './ship-name-crossmatch'
export type { AssetNameMap } from '../../steps/assets/fetch-asset-names'

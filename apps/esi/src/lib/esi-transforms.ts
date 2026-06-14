import type {
	AlliancePublicInfo,
	CharacterAffiliation,
	CharacterAgentResearch,
	CharacterAsset,
	CharacterAssetName,
	CharacterAttributes,
	CharacterBlueprint,
	CharacterCalendar,
	CharacterClones,
	CharacterContact,
	CharacterContract,
	CharacterContractItem,
	CharacterFitting,
	CharacterImplants,
	CharacterKillmailBasic,
	CharacterLocation,
	CharacterMail,
	CharacterMarketOrder,
	CharacterMarketTransaction,
	CharacterMiningLedger,
	CharacterNotification,
	CharacterPlanet,
	CharacterPublicInfo,
	CharacterRoles,
	CharacterShip,
	CharacterSkillQueue,
	CharacterSkills,
	CharacterStanding,
	CharacterTitle,
	CharacterWalletJournalEntry,
	CorporationAsset,
	CorporationContact,
	CorporationContract,
	CorporationDivision,
	CorporationFacility,
	CorporationHistoryEntry,
	CorporationIcon,
	CorporationIndustryJob,
	CorporationKillmail,
	CorporationMedal,
	CorporationMembers,
	CorporationMemberTracking,
	CorporationOrder,
	CorporationPublicInfo,
	CorporationRole,
	CorporationShareholder,
	CorporationStanding,
	CorporationStructure,
	CorporationTitle,
	CorporationWallet,
	CorporationWalletJournalEntry,
	CorporationWalletTransaction,
	EsiCharacterAffiliation,
	EsiAlliancePublicInfo,
	EsiCharacterAgentResearch,
	EsiCharacterAsset,
	EsiCharacterAssetName,
	EsiCharacterAttributes,
	EsiCharacterBlueprint,
	EsiCharacterCalendar,
	EsiCharacterClones,
	EsiCharacterContact,
	EsiCharacterContract,
	EsiCharacterFitting,
	EsiCharacterImplants,
	EsiCharacterKillmail,
	EsiCharacterLocation,
	EsiCharacterMail,
	EsiCharacterMarketOrder,
	EsiCharacterMarketTransaction,
	EsiCharacterMiningLedger,
	EsiCharacterNotification,
	EsiCharacterPlanet,
	EsiCharacterPublicInfo,
	EsiCharacterRoles,
	EsiCharacterShip,
	EsiCharacterSkillQueue,
	EsiCharacterSkills,
	EsiCharacterStanding,
	EsiCharacterTitle,
	EsiCharacterWalletJournalEntry,
	EsiContractItem,
	EsiCorporationAsset,
	EsiCorporationContact,
	EsiCorporationContract,
	EsiCorporationDivision,
	EsiCorporationFacility,
	EsiCorporationHistoryEntry,
	EsiCorporationIcon,
	EsiCorporationIndustryJob,
	EsiCorporationKillmail,
	EsiCorporationMedal,
	EsiCorporationMembers,
	EsiCorporationMemberTracking,
	EsiCorporationOrder,
	EsiCorporationPublicInfo,
	EsiCorporationRole,
	EsiCorporationShareholder,
	EsiCorporationStanding,
	EsiCorporationStructure,
	EsiCorporationTitle,
	EsiCorporationWallet,
	EsiCorporationWalletJournalEntry,
	EsiCorporationWalletTransaction,
	EsiMailContent,
	EsiMailingList,
	EsiMailLabelsResponse,
	EsiStructureInfo,
	MailContent,
	MailingList,
	MailLabelsResponse,
	StructureInfo,
} from '@repo/esi'

export function transformCharacterAffiliation(
	data: EsiCharacterAffiliation[]
): CharacterAffiliation[] {
	return data.map((affiliation) => ({
		...affiliation,
		alliance_id: affiliation.alliance_id ? String(affiliation.alliance_id) : undefined,
		corporation_id: String(affiliation.corporation_id),
		character_id: String(affiliation.character_id),
	}))
}

export function transformCorporationPublicInfo(
	data: EsiCorporationPublicInfo
): CorporationPublicInfo {
	return {
		...data,
		ceo_id: String(data.ceo_id),
		creator_id: String(data.creator_id),
		home_station_id: data.home_station_id ? String(data.home_station_id) : undefined,
		member_count: data.member_count ? String(data.member_count) : undefined,
		shares: data.shares ? String(data.shares) : undefined,
		tax_rate: String(data.tax_rate),
		alliance_id: data.alliance_id ? String(data.alliance_id) : undefined,
		faction_id: data.faction_id ? String(data.faction_id) : undefined,
	}
}

export function transformAlliancePublicInfo(data: EsiAlliancePublicInfo): AlliancePublicInfo {
	return {
		...data,
		creator_corporation_id: String(data.creator_corporation_id),
		creator_id: String(data.creator_id),
		date_founded: data.date_founded,
		executor_corporation_id: data.executor_corporation_id
			? String(data.executor_corporation_id)
			: undefined,
		faction_id: data.faction_id ? String(data.faction_id) : undefined,
	}
}

export function transformCharacterPublicInfo(data: EsiCharacterPublicInfo): CharacterPublicInfo {
	try {
		return {
			alliance_id: data.alliance_id ? String(data.alliance_id) : undefined,
			birthday: data.birthday,
			bloodline_id: String(data.bloodline_id),
			corporation_id: String(data.corporation_id),
			description: data.description,
			faction_id: data.faction_id ? String(data.faction_id) : undefined,
			gender: data.gender,
			name: data.name,
			race_id: String(data.race_id),
			security_status: data.security_status ? String(data.security_status) : undefined,
			title: data.title,
		}
	} catch (error) {
		console.log(`[transformCharacterPublicInfo] Error: ${String(error)}`, {
			data,
			error,
		})
		throw error
	}
}

export function transformCharacterNotifications(
	data: EsiCharacterNotification[]
): CharacterNotification[] {
	return data.map((notification) => ({
		...notification,
		notification_id: String(notification.notification_id),
		sender_id: String(notification.sender_id),
	}))
}

export function transformCorporationMembers(data: EsiCorporationMembers[]): CorporationMembers {
	return data.map((member) => String(member))
}

export function transformCorporationMemberTracking(
	data: EsiCorporationMemberTracking[]
): CorporationMemberTracking[] {
	return data.map((member) => ({
		...member,
		character_id: String(member.character_id),
		base_id: member.base_id ? String(member.base_id) : undefined,
		location_id: member.location_id ? String(member.location_id) : undefined,
		ship_type_id: member.ship_type_id ? String(member.ship_type_id) : undefined,
	}))
}

export function transformCorporationWallets(wallets: EsiCorporationWallet[]): CorporationWallet[] {
	return wallets.map((wallet) => ({
		...wallet,
		balance: wallet.balance.toString(),
	}))
}

export function transformCorporationWalletJournal(
	entries: EsiCorporationWalletJournalEntry[]
): CorporationWalletJournalEntry[] {
	return entries.map((entry) => ({
		...entry,
		id: String(entry.id),
		amount: entry.amount !== undefined ? String(entry.amount) : undefined,
		balance: entry.balance !== undefined ? String(entry.balance) : undefined,
		context_id: entry.context_id ? String(entry.context_id) : undefined,
		first_party_id: entry.first_party_id ? String(entry.first_party_id) : undefined,
		second_party_id: entry.second_party_id ? String(entry.second_party_id) : undefined,
		tax: entry.tax !== undefined ? String(entry.tax) : undefined,
		tax_receiver_id: entry.tax_receiver_id ? String(entry.tax_receiver_id) : undefined,
	}))
}

export function transformCorporationWalletTransactions(
	transactions: EsiCorporationWalletTransaction[]
): CorporationWalletTransaction[] {
	return transactions.map((tx) => ({
		...tx,
		transaction_id: String(tx.transaction_id),
		client_id: String(tx.client_id),
		journal_ref_id: String(tx.journal_ref_id),
		location_id: String(tx.location_id),
		type_id: String(tx.type_id),
		unit_price: String(tx.unit_price),
	}))
}

export function transformCorporationAssets(assets: EsiCorporationAsset[]): CorporationAsset[] {
	return assets.map((asset) => ({
		...asset,
		item_id: String(asset.item_id),
		location_id: String(asset.location_id),
		type_id: String(asset.type_id),
	}))
}

export function transformCorporationStructures(
	structures: EsiCorporationStructure[]
): CorporationStructure[] {
	return structures.map((structure) => ({
		...structure,
		structure_id: String(structure.structure_id),
		type_id: String(structure.type_id),
		system_id: String(structure.system_id),
		profile_id: String(structure.profile_id),
	}))
}

export function transformCorporationOrders(orders: EsiCorporationOrder[]): CorporationOrder[] {
	return orders.map((order) => ({
		...order,
		order_id: String(order.order_id),
		issued_by: String(order.issued_by),
		location_id: String(order.location_id),
		region_id: String(order.region_id),
		type_id: String(order.type_id),
	}))
}

export function transformCorporationContracts(
	contracts: EsiCorporationContract[]
): CorporationContract[] {
	return contracts.map((contract) => ({
		...contract,
		contract_id: String(contract.contract_id),
		acceptor_id: contract.acceptor_id ? String(contract.acceptor_id) : undefined,
		assignee_id: String(contract.assignee_id),
		end_location_id: contract.end_location_id ? String(contract.end_location_id) : undefined,
		issuer_corporation_id: String(contract.issuer_corporation_id),
		issuer_id: String(contract.issuer_id),
		start_location_id: contract.start_location_id ? String(contract.start_location_id) : undefined,
	}))
}

export function transformCorporationIndustryJobs(
	jobs: EsiCorporationIndustryJob[]
): CorporationIndustryJob[] {
	return jobs.map((job) => ({
		...job,
		job_id: String(job.job_id),
		installer_id: String(job.installer_id),
		facility_id: String(job.facility_id),
		location_id: String(job.location_id),
		activity_id: String(job.activity_id),
		blueprint_id: String(job.blueprint_id),
		blueprint_type_id: String(job.blueprint_type_id),
		blueprint_location_id: String(job.blueprint_location_id),
		output_location_id: String(job.output_location_id),
		product_type_id: job.product_type_id ? String(job.product_type_id) : undefined,
		completed_character_id: job.completed_character_id
			? String(job.completed_character_id)
			: undefined,
	}))
}

export function transformCorporationKillmails(
	killmails: EsiCorporationKillmail[]
): CorporationKillmail[] {
	return killmails.map((km) => ({
		...km,
		killmail_id: String(km.killmail_id),
	}))
}

export function transformCharacterKillmails(
	killmails: EsiCharacterKillmail[]
): CharacterKillmailBasic[] {
	return killmails.map((km) => ({
		...km,
		killmail_id: String(km.killmail_id),
	}))
}

export function transformCorporationContact(
	contacts: EsiCorporationContact[]
): CorporationContact[] {
	return contacts.map((contact) => ({
		...contact,
		contact_id: String(contact.contact_id),
		label_ids: contact.label_ids?.map(String),
	}))
}

export function transformCorporationDivision(data: EsiCorporationDivision): CorporationDivision {
	return { ...data }
}

export function transformCorporationFacility(
	facilities: EsiCorporationFacility[]
): CorporationFacility[] {
	return facilities.map((facility) => ({
		...facility,
		facility_id: String(facility.facility_id),
		system_id: String(facility.system_id),
		type_id: String(facility.type_id),
	}))
}

export function transformCorporationIcon(data: EsiCorporationIcon): CorporationIcon {
	return { ...data }
}

export function transformCorporationMedal(medals: EsiCorporationMedal[]): CorporationMedal[] {
	return medals.map((medal) => ({
		...medal,
		creator_id: String(medal.creator_id),
		medal_id: String(medal.medal_id),
	}))
}

export function transformCorporationRole(roles: EsiCorporationRole[]): CorporationRole[] {
	return roles.map((role) => ({
		...role,
		character_id: String(role.character_id),
	}))
}

export function transformCorporationShareholder(
	shareholders: EsiCorporationShareholder[]
): CorporationShareholder[] {
	return shareholders.map((shareholder) => ({
		...shareholder,
		shareholder_id: String(shareholder.shareholder_id),
	}))
}

export function transformCorporationStanding(
	standings: EsiCorporationStanding[]
): CorporationStanding[] {
	return standings.map((standing) => ({
		...standing,
		from_id: String(standing.from_id),
	}))
}

export function transformCorporationTitle(titles: EsiCorporationTitle[]): CorporationTitle[] {
	return titles.map((title) => ({
		...title,
		title_id: title.title_id ? String(title.title_id) : undefined,
	}))
}

// ============================================================================
// CHARACTER TRANSFORMERS
// ============================================================================

export function transformCharacterAgentResearch(
	research: EsiCharacterAgentResearch[]
): CharacterAgentResearch[] {
	return research.map((entry) => ({
		...entry,
		agent_id: String(entry.agent_id),
		skill_type_id: String(entry.skill_type_id),
	}))
}

export function transformCharacterAsset(assets: EsiCharacterAsset[]): CharacterAsset[] {
	return assets.map((asset) => ({
		...asset,
		item_id: String(asset.item_id),
		location_id: String(asset.location_id),
		type_id: String(asset.type_id),
	}))
}

export function transformCharacterAssetNames(names: EsiCharacterAssetName[]): CharacterAssetName[] {
	return names.map((entry) => ({
		item_id: String(entry.item_id),
		name: entry.name,
	}))
}

export function transformCharacterAttributes(data: EsiCharacterAttributes): CharacterAttributes {
	return { ...data }
}

export function transformCharacterBlueprint(
	blueprints: EsiCharacterBlueprint[]
): CharacterBlueprint[] {
	return blueprints.map((blueprint) => ({
		...blueprint,
		item_id: String(blueprint.item_id),
		location_id: String(blueprint.location_id),
		type_id: String(blueprint.type_id),
	}))
}

export function transformCharacterCalendar(calendar: EsiCharacterCalendar[]): CharacterCalendar[] {
	return calendar.map((event) => ({
		...event,
		event_id: String(event.event_id),
	}))
}

export function transformCharacterContact(contacts: EsiCharacterContact[]): CharacterContact[] {
	return contacts.map((contact) => ({
		...contact,
		contact_id: String(contact.contact_id),
		label_ids: contact.label_ids?.map(String),
	}))
}

export function transformCharacterContract(contracts: EsiCharacterContract[]): CharacterContract[] {
	return contracts.map((contract) => ({
		...contract,
		acceptor_id: contract.acceptor_id ? String(contract.acceptor_id) : undefined,
		assignee_id: String(contract.assignee_id),
		contract_id: String(contract.contract_id),
		end_location_id: contract.end_location_id ? String(contract.end_location_id) : undefined,
		issuer_corporation_id: String(contract.issuer_corporation_id),
		issuer_id: String(contract.issuer_id),
		start_location_id: contract.start_location_id ? String(contract.start_location_id) : undefined,
	}))
}

export function transformContractItems(items: EsiContractItem[]): CharacterContractItem[] {
	return items.map((item) => ({
		...item,
		record_id: String(item.record_id),
		type_id: String(item.type_id),
	}))
}

export function transformCharacterFitting(fittings: EsiCharacterFitting[]): CharacterFitting[] {
	return fittings.map((fitting) => ({
		...fitting,
		fitting_id: String(fitting.fitting_id),
		items: fitting.items.map((item) => ({
			...item,
			type_id: String(item.type_id),
		})),
		ship_type_id: String(fitting.ship_type_id),
	}))
}

export function transformCharacterLocation(data: EsiCharacterLocation): CharacterLocation {
	return {
		...data,
		solar_system_id: String(data.solar_system_id),
		station_id: data.station_id ? String(data.station_id) : undefined,
		structure_id: data.structure_id ? String(data.structure_id) : undefined,
	}
}

export function transformCharacterMail(mails: EsiCharacterMail[]): CharacterMail[] {
	return mails.map((mail) => ({
		...mail,
		from: mail.from ? String(mail.from) : undefined,
		labels: mail.labels?.map(String),
		mail_id: mail.mail_id ? String(mail.mail_id) : undefined,
		recipients: mail.recipients?.map((recipient) => ({
			...recipient,
			recipient_id: String(recipient.recipient_id),
		})),
	}))
}

export function transformMailContent(content: EsiMailContent): MailContent {
	return {
		...content,
		from: content.from ? String(content.from) : undefined,
		labels: content.labels?.map(String),
	}
}

export function transformMailingLists(lists: EsiMailingList[]): MailingList[] {
	return lists.map((list) => ({
		mailing_list_id: String(list.mailing_list_id),
		name: list.name,
	}))
}

export function transformMailLabels(data: EsiMailLabelsResponse): MailLabelsResponse {
	return {
		labels: data.labels?.map((label) => ({
			color: label.color,
			label_id: String(label.label_id),
			name: label.name,
			unread_count: label.unread_count,
		})),
		total_unread_count: data.total_unread_count,
	}
}

export function transformCharacterMiningLedger(
	ledger: EsiCharacterMiningLedger[]
): CharacterMiningLedger[] {
	return ledger.map((entry) => ({
		...entry,
		solar_system_id: String(entry.solar_system_id),
		type_id: String(entry.type_id),
	}))
}

export function transformCharacterPlanet(planets: EsiCharacterPlanet[]): CharacterPlanet[] {
	return planets.map((planet) => ({
		...planet,
		owner_id: String(planet.owner_id),
		planet_id: String(planet.planet_id),
		solar_system_id: String(planet.solar_system_id),
	}))
}

export function transformCharacterRoles(data: EsiCharacterRoles): CharacterRoles {
	return { ...data }
}

export function transformCharacterSkillQueue(
	queue: EsiCharacterSkillQueue[]
): CharacterSkillQueue[] {
	return queue.map((entry) => ({
		...entry,
		skill_id: String(entry.skill_id),
	}))
}

export function transformCharacterShip(data: EsiCharacterShip): CharacterShip {
	return {
		...data,
		ship_item_id: String(data.ship_item_id),
		ship_type_id: String(data.ship_type_id),
	}
}

export function transformCharacterSkills(data: EsiCharacterSkills): CharacterSkills {
	return {
		...data,
		skills: data.skills.map((skill) => ({
			...skill,
			skill_id: String(skill.skill_id),
		})),
	}
}

export function transformCharacterStanding(standings: EsiCharacterStanding[]): CharacterStanding[] {
	return standings.map((standing) => ({
		...standing,
		from_id: String(standing.from_id),
	}))
}

export function transformCharacterTitle(titles: EsiCharacterTitle[]): CharacterTitle[] {
	return titles.map((title) => ({
		...title,
		title_id: title.title_id ? String(title.title_id) : undefined,
	}))
}

export function transformCorporationHistoryEntry(
	history: EsiCorporationHistoryEntry[]
): CorporationHistoryEntry[] {
	return history.map((entry) => ({
		...entry,
		corporation_id: String(entry.corporation_id),
		record_id: String(entry.record_id),
	}))
}

export function transformCharacterMarketOrder(
	orders: EsiCharacterMarketOrder[]
): CharacterMarketOrder[] {
	return orders.map((order) => ({
		...order,
		order_id: String(order.order_id),
		type_id: String(order.type_id),
		location_id: String(order.location_id),
		region_id: String(order.region_id),
	}))
}

export function transformCharacterMarketTransaction(
	transactions: EsiCharacterMarketTransaction[]
): CharacterMarketTransaction[] {
	return transactions.map((tx) => ({
		...tx,
		transaction_id: String(tx.transaction_id),
		type_id: String(tx.type_id),
		client_id: String(tx.client_id),
		location_id: String(tx.location_id),
		journal_ref_id: String(tx.journal_ref_id),
	}))
}

export function transformCharacterWalletJournal(
	entries: EsiCharacterWalletJournalEntry[]
): CharacterWalletJournalEntry[] {
	return entries.map((entry) => ({
		...entry,
		id: String(entry.id),
		amount: String(entry.amount),
		balance: entry.balance !== undefined ? String(entry.balance) : undefined,
		first_party_id: entry.first_party_id ? String(entry.first_party_id) : undefined,
		second_party_id: entry.second_party_id ? String(entry.second_party_id) : undefined,
		tax: entry.tax !== undefined ? String(entry.tax) : undefined,
		tax_receiver_id: entry.tax_receiver_id ? String(entry.tax_receiver_id) : undefined,
		context_id: entry.context_id ? String(entry.context_id) : undefined,
	}))
}

export function transformStructureInfo(data: EsiStructureInfo): StructureInfo {
	return {
		...data,
		owner_id: String(data.owner_id),
		solar_system_id: String(data.solar_system_id),
		type_id: String(data.type_id),
	}
}

export function transformCharacterClones(data: EsiCharacterClones): CharacterClones {
	return {
		home_location: data.home_location
			? {
					location_id: String(data.home_location.location_id),
					location_type: data.home_location.location_type,
				}
			: undefined,
		jump_clones: data.jump_clones.map((clone) => ({
			implants: clone.implants.map(String),
			jump_clone_id: String(clone.jump_clone_id),
			location_id: String(clone.location_id),
			location_type: clone.location_type,
			name: clone.name,
		})),
		last_clone_jump_date: data.last_clone_jump_date,
		last_station_change_date: data.last_station_change_date,
	}
}

export function transformCharacterImplants(data: EsiCharacterImplants): CharacterImplants {
	return data.map(String)
}

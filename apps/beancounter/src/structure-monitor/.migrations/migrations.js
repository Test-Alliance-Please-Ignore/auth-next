import m0000 from './0000_shallow_the_stranger.sql?raw'
import m0001 from './0001_abandoned_firebird.sql?raw'
import m0002 from './0002_acoustic_titanium_man.sql?raw'
import m0003 from './0003_noisy_miek.sql?raw'
import m0004 from './0004_wise_scourge.sql?raw'
import m0005 from './0005_panoramic_skin.sql?raw'
import journal from './meta/_journal.json'

export default {
	journal,
	migrations: {
		m0000,
		m0001,
		m0002,
		m0003,
		m0004,
		m0005,
	},
}

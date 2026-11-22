const SPLITMIX_INCREMENT: u64 = 0x9E37_79B9_7F4A_7C15;
const SPLITMIX_FIRST_MULTIPLIER: u64 = 0xBF58_476D_1CE4_E5B9;
const SPLITMIX_SECOND_MULTIPLIER: u64 = 0x94D0_49BB_1331_11EB;
const RANDOMNESS_BYTES: usize = 32;

pub struct SeededRandom {
    state: u64,
}

impl SeededRandom {
    pub fn from_seed(seed: u64) -> SeededRandom {
        SeededRandom { state: seed }
    }

    pub fn next_splitmix64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(SPLITMIX_INCREMENT);
        let mut mixed = self.state;
        mixed = (mixed ^ (mixed >> 30)).wrapping_mul(SPLITMIX_FIRST_MULTIPLIER);
        mixed = (mixed ^ (mixed >> 27)).wrapping_mul(SPLITMIX_SECOND_MULTIPLIER);
        mixed ^ (mixed >> 31)
    }

    pub fn value_between(&mut self, lowest: u64, highest: u64) -> u64 {
        let span = highest.saturating_sub(lowest).saturating_add(1);
        lowest.saturating_add(self.next_splitmix64() % span)
    }

    pub fn vrf_randomness(&mut self) -> [u8; RANDOMNESS_BYTES] {
        let mut randomness = [0u8; RANDOMNESS_BYTES];
        for chunk in randomness.as_chunks_mut::<8>().0 {
            *chunk = self.next_splitmix64().to_le_bytes();
        }
        randomness
    }
}

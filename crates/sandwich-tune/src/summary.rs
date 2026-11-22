use crate::bots::{Temperament, TEMPERAMENTS};
use crate::events::{RecordedRound, RoundEvent};

pub struct TemperamentCrumbs {
    pub temperament: Temperament,
    pub pigeon_count: usize,
    pub crumbs: u64,
}

pub struct RoundSummary {
    pub players: usize,
    pub seed: u64,
    pub whale_seat: Option<u8>,
    pub whale_crumbs: u64,
    pub anted_crumbs: u64,
    pub swat_count: usize,
    pub hit_count: usize,
    pub per_temperament: Vec<TemperamentCrumbs>,
}

pub fn summarize_round(round: &RecordedRound) -> RoundSummary {
    let mut whale_seat = None;
    let mut whale_crumbs = 0;
    let mut pigeon_crumbs = 0;
    let mut swat_count = 0;
    let mut hit_count = 0;
    let mut beaks = Vec::new();
    for timed in &round.events {
        match &timed.event {
            RoundEvent::WhaleDrawn { whale_seat: seat, .. } => whale_seat = Some(*seat),
            RoundEvent::SwatLanded { hits, .. } => {
                swat_count += 1;
                hit_count += hits.len();
            }
            RoundEvent::Settled { whale_crumbs: whale, pigeon_crumbs: pigeons, beaks: settled } => {
                whale_crumbs = *whale;
                pigeon_crumbs = *pigeons;
                beaks.clone_from(settled);
            }
            _ => {}
        }
    }
    let per_temperament = TEMPERAMENTS
        .iter()
        .map(|temperament| {
            let seats_with_temperament: Vec<u8> = round
                .header
                .players
                .iter()
                .filter(|player| player.temperament == *temperament && Some(player.seat) != whale_seat)
                .map(|player| player.seat)
                .collect();
            let crumbs = beaks
                .iter()
                .filter(|beak| seats_with_temperament.contains(&beak.seat))
                .map(|beak| beak.crumbs)
                .sum();
            TemperamentCrumbs {
                temperament: *temperament,
                pigeon_count: seats_with_temperament.len(),
                crumbs,
            }
        })
        .collect();
    RoundSummary {
        players: round.header.players.len(),
        seed: round.header.seed,
        whale_seat,
        whale_crumbs,
        anted_crumbs: whale_crumbs + pigeon_crumbs,
        swat_count,
        hit_count,
        per_temperament,
    }
}

impl core::fmt::Display for RoundSummary {
    fn fmt(&self, formatter: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        let whale_percent = if self.anted_crumbs == 0 {
            0.0
        } else {
            self.whale_crumbs as f64 * 100.0 / self.anted_crumbs as f64
        };
        write!(
            formatter,
            "players {} seed {} whale seat {} keeps {} of {} ({whale_percent:.1}%), swats {} hits {}",
            self.players,
            self.seed,
            self.whale_seat.map_or_else(|| "none".to_string(), |seat| seat.to_string()),
            self.whale_crumbs,
            self.anted_crumbs,
            self.swat_count,
            self.hit_count,
        )?;
        for entry in &self.per_temperament {
            write!(
                formatter,
                ", {:?} {} crumbs over {} pigeons",
                entry.temperament, entry.crumbs, entry.pigeon_count
            )?;
        }
        Ok(())
    }
}

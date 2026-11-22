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

pub struct BalanceSummary {
    pub rounds: usize,
    pub whale_share_mean: f64,
    pub whale_share_spread: f64,
    pub swats_mean: f64,
    pub emptied_early_share: f64,
    pub crumbs_per_temperament: Vec<(Temperament, f64)>,
}

fn whale_share(summary: &RoundSummary) -> f64 {
    if summary.anted_crumbs == 0 {
        return 1.0;
    }
    summary.whale_crumbs as f64 / summary.anted_crumbs as f64
}

pub fn summarize_rounds(summaries: &[RoundSummary]) -> BalanceSummary {
    let count = summaries.len().max(1) as f64;
    let shares: Vec<f64> = summaries.iter().map(whale_share).collect();
    let mean = shares.iter().sum::<f64>() / count;
    let spread = (shares.iter().map(|share| (share - mean).powi(2)).sum::<f64>() / count).sqrt();
    let crumbs_per_temperament = TEMPERAMENTS
        .iter()
        .map(|temperament| {
            let (crumbs, pigeons) = summaries
                .iter()
                .flat_map(|summary| summary.per_temperament.iter())
                .filter(|entry| entry.temperament == *temperament)
                .fold((0_u64, 0_usize), |(crumbs, pigeons), entry| (crumbs + entry.crumbs, pigeons + entry.pigeon_count));
            (*temperament, crumbs as f64 / pigeons.max(1) as f64)
        })
        .collect();
    BalanceSummary {
        rounds: summaries.len(),
        whale_share_mean: mean,
        whale_share_spread: spread,
        swats_mean: summaries.iter().map(|summary| summary.swat_count as f64).sum::<f64>() / count,
        emptied_early_share: summaries.iter().filter(|summary| summary.whale_crumbs == 0).count() as f64 / count,
        crumbs_per_temperament,
    }
}

impl core::fmt::Display for BalanceSummary {
    fn fmt(&self, formatter: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(
            formatter,
            "{} rounds, whale keeps {:.1}% (spread {:.1}), {:.1} swats, pot emptied {:.1}%",
            self.rounds,
            self.whale_share_mean * 100.0,
            self.whale_share_spread * 100.0,
            self.swats_mean,
            self.emptied_early_share * 100.0,
        )?;
        for (temperament, crumbs) in &self.crumbs_per_temperament {
            write!(formatter, ", {temperament:?} {crumbs:.1} crumbs")?;
        }
        Ok(())
    }
}

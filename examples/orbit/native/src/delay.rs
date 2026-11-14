//! Three independent feedback lines, each with its own time, level, tone
//! filter, drift and place in the stereo field, and a Hold that loops what
//! they hold. Allocates only in `prepare`; `tick` never allocates or locks.

use std::f64::consts::PI;

/// What the delay is set to, from the parameters (times in seconds).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Settings {
    pub times: [f32; 3],
    pub levels: [f32; 3],
    pub feedback: f32,
    pub tone: f32,
    pub motion: f32,
    pub spread: f32,
    pub mix: f32,
    pub hold: bool,
    pub bypass: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            times: [0.375, 0.75, 1.125],
            levels: [0.8, 0.55, 0.35],
            feedback: 0.48,
            tone: 0.55,
            motion: 0.18,
            spread: 0.75,
            mix: 0.35,
            hold: false,
            bypass: false,
        }
    }
}

#[derive(Default)]
pub struct Delay {
    buffers: [Vec<f32>; 3],
    delays: [f64; 3],
    filtered: [f64; 3],
    starts: [f64; 3],
    lengths: [f64; 3],
    phases: [f64; 3],
    levels: [f64; 3],
    rate: f64,
    clock: f64,
    smooth: f64,
    wet: f64,
    blend: f64,
    cutoff: f64,
    feedback: f64,
    motion: f64,
    spread: f64,
    capacity: usize,
    write: usize,
    held: bool,
}

impl Delay {
    /// Sizes the lines for ten seconds at `rate`, and starts them silent.
    pub fn prepare(&mut self, rate: f64) {
        self.rate = rate;
        self.capacity = (rate * 10.0).ceil() as usize + 2;
        for buffer in &mut self.buffers {
            buffer.clear();
            buffer.resize(self.capacity, 0.0);
        }
        self.delays = [rate * 0.375, rate * 0.75, rate * 1.125];
        self.smooth = 1.0 - (-1.0 / (0.02 * rate)).exp();
        self.cutoff = 0.1;
        self.reset();
    }

    /// Silences the lines and starts every smoothed value over.
    pub fn reset(&mut self) {
        for buffer in &mut self.buffers {
            buffer.fill(0.0);
        }
        self.filtered = [0.0; 3];
        self.levels = [0.8, 0.55, 0.35];
        self.feedback = 0.48;
        self.motion = 0.18;
        self.spread = 0.75;
        self.phases = [0.0; 3];
        self.write = 0;
        self.clock = 0.0;
        self.held = false;
        self.wet = 0.0;
        self.blend = 0.0;
    }

    /// What changes once a block: the tone filter.
    pub fn configure(&mut self, settings: &Settings) {
        let frequency = (self.rate * 0.45).min(400.0 * 30f64.powf(f64::from(settings.tone)));
        self.cutoff = 1.0 - (-2.0 * PI * frequency / self.rate).exp();
    }

    /// One frame: the input's left and right, then the output's.
    pub fn tick(&mut self, left: f32, right: f32, settings: &Settings) -> [f32; 2] {
        let (left, right) = (f64::from(left), f64::from(right));
        let capacity = self.capacity as f64;
        if settings.hold && !self.held {
            for i in 0..3 {
                self.lengths[i] = self.delays[i].round().max(128.0);
                self.starts[i] = self.write as f64 - self.lengths[i];
                self.phases[i] = 0.0;
            }
        }
        self.held = settings.hold;
        let smooth = self.smooth;
        self.feedback += (f64::from(settings.feedback) - self.feedback) * smooth;
        self.motion += (f64::from(settings.motion) - self.motion) * smooth;
        self.spread += (f64::from(settings.spread) - self.spread) * smooth;
        let (mut wet_left, mut wet_right) = (0.0, 0.0);
        for i in 0..3 {
            let target = (f64::from(settings.times[i]) * self.rate).clamp(128.0, capacity - 2.0);
            self.delays[i] += (target - self.delays[i]) * smooth;
            let voice = i as f64;
            let drift = (self.clock * (0.7 + voice * 0.13) + voice * 2.1).sin()
                * self.motion
                * self.rate
                * 0.003;
            let echo = if self.held {
                let (phase, length) = (self.phases[i], self.lengths[i]);
                let mut echo = self.read(i, self.starts[i] + phase);
                if phase > length - 64.0 {
                    let fade = (phase - length + 64.0) / 64.0;
                    echo = echo * (1.0 - fade)
                        + self.read(i, self.starts[i] + phase - length + 64.0) * fade;
                }
                self.phases[i] = phase + length / self.delays[i] * (1.0 + drift / self.rate * 5.0);
                if self.phases[i] >= length {
                    self.phases[i] = 64.0 + (self.phases[i] - length) % (length - 64.0);
                }
                echo
            } else {
                self.read(i, self.write as f64 - self.delays[i] + drift)
            };
            self.filtered[i] += (echo - self.filtered[i]) * self.cutoff;
            if !self.held {
                self.buffers[i][self.write] =
                    ((left + right) * 0.5 + self.filtered[i] * self.feedback).tanh() as f32;
            }
            self.levels[i] += (f64::from(settings.levels[i]) - self.levels[i]) * smooth;
            let pan = (voice - 1.0) * self.spread;
            let voiced = self.filtered[i] * self.levels[i] * 0.6;
            wet_left += voiced * ((1.0 - pan) * 0.5).sqrt();
            wet_right += voiced * ((1.0 + pan) * 0.5).sqrt();
        }
        if !self.held {
            self.write = (self.write + 1) % self.capacity;
        }
        self.clock += 1.0 / self.rate;
        self.wet += (f64::from(settings.mix) - self.wet) * smooth;
        self.blend += (if settings.bypass { 0.0 } else { 1.0 } - self.blend) * smooth;
        let mix = self.wet * self.blend;
        [
            (left * (1.0 - mix) + wet_left * mix) as f32,
            (right * (1.0 - mix) + wet_right * mix) as f32,
        ]
    }

    fn read(&self, voice: usize, position: f64) -> f64 {
        let capacity = self.capacity as f64;
        // Twice: a position just below zero wraps to `capacity` itself, one
        // past the end, once added to it.
        let wrapped = ((position % capacity) + capacity) % capacity;
        let index = wrapped as usize;
        let fraction = wrapped - index as f64;
        let buffer = &self.buffers[voice];
        f64::from(buffer[index]) * (1.0 - fraction)
            + f64::from(buffer[(index + 1) % self.capacity]) * fraction
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn one_voice() -> Settings {
        Settings {
            times: [0.1, 0.2, 0.3],
            levels: [1.0, 0.0, 0.0],
            feedback: 0.0,
            motion: 0.0,
            mix: 1.0,
            spread: 1.0,
            tone: 1.0,
            ..Settings::default()
        }
    }

    #[test]
    fn an_impulse_comes_back_after_the_first_voice_s_time_on_its_side() {
        const RATE: usize = 8000;
        let mut delay = Delay::default();
        delay.prepare(RATE as f64);
        let settings = one_voice();
        delay.configure(&settings);
        for _ in 0..RATE {
            delay.tick(0.0, 0.0, &settings);
        }
        let mut first = None;
        let mut energy = 0.0;
        for i in 0..2000 {
            let input = if i == 0 { 1.0 } else { 0.0 };
            let [left, right] = delay.tick(input, input, &settings);
            if left.abs() > 0.001 && first.is_none() {
                first = Some(i);
            }
            energy += f64::from(left * left);
            // Full spread: the first voice is all left.
            assert!(right.abs() < 1e-6, "{right}");
        }
        assert!((799..=802).contains(&first.unwrap()), "{first:?}");
        assert!(energy > 0.05, "{energy}");
    }

    #[test]
    fn hold_loops_what_the_lines_hold() {
        const RATE: usize = 8000;
        let mut delay = Delay::default();
        delay.prepare(RATE as f64);
        let mut settings = one_voice();
        delay.configure(&settings);
        for i in 0..RATE {
            delay.tick(((i as f64 * 0.07).sin() * 0.3) as f32, 0.0, &settings);
        }
        settings.hold = true;
        let mut energy = 0.0;
        for _ in 0..RATE * 2 {
            let [left, _] = delay.tick(0.0, 0.0, &settings);
            assert!(left.is_finite());
            energy += f64::from(left * left);
        }
        assert!(energy > 1.0, "{energy}");
    }

    #[test]
    fn bypass_passes_the_input() {
        let mut delay = Delay::default();
        delay.prepare(8000.0);
        let settings = Settings {
            bypass: true,
            ..one_voice()
        };
        delay.configure(&settings);
        for _ in 0..8000 {
            delay.tick(0.25, -0.125, &settings);
        }
        let [left, right] = delay.tick(0.25, -0.125, &settings);
        assert!((left - 0.25).abs() < 1e-6 && (right + 0.125).abs() < 1e-6);
    }

    #[test]
    fn a_read_just_below_zero_stays_within_the_line() {
        // With no Motion, the third voice's read lands just below zero as the
        // write position reaches its delay; indexing past the end would panic.
        let mut delay = Delay::default();
        delay.prepare(48_000.0);
        let settings = Settings {
            motion: 0.0,
            ..Settings::default()
        };
        delay.configure(&settings);
        for _ in 0..48_000 * 2 {
            delay.tick(0.0, 0.0, &settings);
        }
    }

    #[test]
    fn reset_silences_the_lines() {
        let mut delay = Delay::default();
        delay.prepare(8000.0);
        let settings = one_voice();
        delay.configure(&settings);
        for _ in 0..4000 {
            delay.tick(0.5, 0.5, &settings);
        }
        delay.reset();
        for _ in 0..16_000 {
            let [left, right] = delay.tick(0.0, 0.0, &settings);
            assert_eq!((left, right), (0.0, 0.0));
        }
    }
}

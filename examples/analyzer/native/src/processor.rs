//! A spectrum analyzer: passes its audio through, and publishes the spectrum
//! and peak of what it hears to the UI, through the config's native streams
//! (`ctx.streams`), from the audio thread: realtime-safe, the latest only.

pub mod fft;

use soundor::prelude::*;

use fft::Fft;

const FFT_SIZE: usize = 2048;
/// A spectrum every half window (1024 samples): about 47 a second at 48 kHz.
const HOP: usize = FFT_SIZE / 2;
/// As soundor.config declares `spectrum` (maxLength: 128).
pub const BANDS: usize = 128;

/// `gain` in decibels, at least -96.
pub fn decibels(gain: f32) -> f32 {
    if gain > 0.0 {
        (20.0 * gain.log10()).max(-96.0)
    } else {
        -96.0
    }
}

#[derive(Default)]
pub struct PluginProcessor {
    fft: Option<Fft>,
    window: Vec<f32>,
    /// The last FFT_SIZE samples (mono), written circularly.
    history: Vec<f32>,
    written: usize,
    since_last: usize,
    transform: Vec<f32>,
    /// The FFT bins each band covers, from `band_start[band]` to `band_start[band + 1]`.
    band_start: Vec<usize>,
}

impl Processor for PluginProcessor {
    fn prepare(&mut self, ctx: &PrepareContext) {
        self.fft = Some(Fft::new(FFT_SIZE));
        // Hann, normalized to an average of 1.
        let hann: Vec<f64> = (0..FFT_SIZE)
            .map(|i| {
                0.5 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / (FFT_SIZE - 1) as f64).cos()
            })
            .collect();
        let sum: f64 = hann.iter().sum();
        self.window = hann
            .iter()
            .map(|value| (value * FFT_SIZE as f64 / sum) as f32)
            .collect();
        self.history = vec![0.0; FFT_SIZE];
        self.transform = vec![0.0; FFT_SIZE];
        self.written = 0;
        self.since_last = 0;
        // Bands spaced evenly in pitch from 20 Hz to 20 kHz (or Nyquist), each
        // at least one bin wide.
        let nyquist = ctx.sample_rate / 2.0;
        let (low, high) = (20.0, nyquist.min(20_000.0));
        let bins = FFT_SIZE / 2;
        self.band_start = vec![0; BANDS + 1];
        for band in 0..=BANDS {
            let frequency = low * (high / low).powf(band as f64 / BANDS as f64);
            let bin = ((frequency / nyquist * bins as f64).round() as usize).clamp(1, bins);
            self.band_start[band] = if band == 0 {
                bin
            } else {
                bin.max(self.band_start[band - 1])
            };
        }
    }

    fn process(&mut self, ctx: &mut ProcessContext) {
        let channels = ctx.audio.channel_count();
        if channels == 0 {
            return;
        }
        let mut peak = 0.0f32;
        for frame in 0..ctx.audio.frames() {
            let mono = (0..channels)
                .filter_map(|channel| ctx.audio.channel(channel))
                .map(|samples| samples[frame])
                .sum::<f32>()
                / channels as f32;
            peak = peak.max(mono.abs());
            self.history[self.written] = mono;
            self.written = (self.written + 1) % FFT_SIZE;
            self.since_last += 1;
            if self.since_last == HOP {
                self.since_last = 0;
                self.analyze(ctx.streams.spectrum.buffer_mut());
                ctx.streams.spectrum.commit(BANDS);
            }
        }
        ctx.streams.peak.publish(decibels(peak));
    }

    fn reset(&mut self) {
        self.history.fill(0.0);
        self.written = 0;
        self.since_last = 0;
    }
}

impl PluginProcessor {
    /// The window's spectrum, by band, in decibels, written straight into the
    /// stream's own storage: the UI never sees a partly written one.
    fn analyze(&mut self, spectrum: &mut [f32]) {
        let Some(fft) = self.fft.as_mut() else { return };
        // The window, oldest sample first.
        for (index, sample) in self.transform.iter_mut().enumerate() {
            *sample = self.history[(self.written + index) % FFT_SIZE] * self.window[index];
        }
        fft.magnitudes(&mut self.transform);
        // Hann's gain, both halves.
        let scale = 4.0 / FFT_SIZE as f32;
        for (band, level) in spectrum.iter_mut().take(BANDS).enumerate() {
            let first = self.band_start[band];
            let last = (first + 1).max(self.band_start[band + 1]);
            let magnitude = self.transform[first..last.min(FFT_SIZE / 2 + 1)]
                .iter()
                .fold(0.0f32, |loudest, bin| loudest.max(*bin));
            *level = decibels(magnitude * scale);
        }
    }
}

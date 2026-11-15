//! The analyzer through Soundor's testing harness: what it publishes to the
//! config's channels, and that its audio passes through untouched.

use soundor::testing::TestProcessor;
use soundor_analyzer::{BANDS, Processor};

const RATE: f64 = 48_000.0;

fn sine(frequency: f64, amplitude: f32, frames: usize) -> Vec<f32> {
    (0..frames)
        .map(|i| {
            (2.0 * std::f64::consts::PI * frequency * i as f64 / RATE).sin() as f32 * amplitude
        })
        .collect()
}

/// The band whose range holds `frequency`, as the analyzer spaces them.
fn band_of(frequency: f64) -> usize {
    let (low, high) = (20.0f64, 20_000.0f64);
    ((frequency / low).ln() / (high / low).ln() * BANDS as f64).floor() as usize
}

#[test]
fn passes_its_audio_through() {
    let mut processor = TestProcessor::<Processor>::new().sample_rate(RATE).build();
    let input = sine(440.0, 0.5, 4096);
    let output = processor.process(&[input.clone(), input.clone()]);
    assert_eq!(output, [input.clone(), input]);
}

#[test]
fn publishes_the_peak_of_each_block() {
    let mut processor = TestProcessor::<Processor>::new()
        .sample_rate(RATE)
        .block_size(256)
        .build();
    processor.process(&[vec![0.5; 256], vec![0.5; 256]]);
    let peak = processor.channel("peak").unwrap();
    assert!((peak - -6.0206).abs() < 1e-3, "{peak}");
    processor.process(&[vec![0.0; 256], vec![0.0; 256]]);
    assert_eq!(processor.channel("peak"), Some(-96.0));
}

#[test]
fn finds_a_tone_in_its_band() {
    let mut processor = TestProcessor::<Processor>::new().sample_rate(RATE).build();
    let tone = sine(1000.0, 0.5, 8192);
    processor.process(&[tone.clone(), tone]);
    let spectrum = processor.channel_buffer::<f32>("spectrum").unwrap();
    assert_eq!(spectrum.len(), BANDS);
    let loudest = (0..BANDS)
        .max_by(|a, b| spectrum[*a].total_cmp(&spectrum[*b]))
        .unwrap();
    assert!(
        loudest.abs_diff(band_of(1000.0)) <= 1,
        "band {loudest}, expected {}",
        band_of(1000.0)
    );
    assert!(spectrum[loudest] > -12.0, "{}", spectrum[loudest]);
    // Far from it, far quieter.
    assert!(spectrum[band_of(100.0)] < spectrum[loudest] - 40.0);
}

#[test]
fn publishes_a_spectrum_every_half_window() {
    let mut processor = TestProcessor::<Processor>::new().sample_rate(RATE).build();
    processor.process(&[vec![0.0; 1023]]);
    assert_eq!(processor.channel_buffer::<f32>("spectrum"), None);
    processor.process(&[vec![0.0; 1]]);
    let silence = processor.channel_buffer::<f32>("spectrum").unwrap();
    assert!(silence.iter().all(|level| *level == -96.0));
}

#[test]
fn analyzes_mono_too() {
    let mut processor = TestProcessor::<Processor>::new()
        .sample_rate(RATE)
        .layout(&[1], &[1])
        .build();
    processor.process(&[sine(1000.0, 0.5, 4096)]);
    assert!(processor.channel_buffer::<f32>("spectrum").is_some());
    assert!(processor.channel("peak").unwrap() > -7.0);
}

//! A radix-2 FFT of a real signal, for magnitudes: its tables are made once,
//! in `new`, and `magnitudes` neither allocates nor locks.

use std::f64::consts::PI;

pub struct Fft {
    size: usize,
    reversed: Vec<usize>,
    cosines: Vec<f32>,
    sines: Vec<f32>,
    real: Vec<f32>,
    imaginary: Vec<f32>,
}

impl Fft {
    /// An FFT of `size` points, a power of two.
    pub fn new(size: usize) -> Self {
        assert!(size.is_power_of_two() && size >= 2);
        let bits = size.trailing_zeros();
        let reversed = (0..size)
            .map(|index| index.reverse_bits() >> (usize::BITS - bits))
            .collect();
        let angle = |index: usize| -2.0 * PI * index as f64 / size as f64;
        Self {
            size,
            reversed,
            cosines: (0..size / 2).map(|i| angle(i).cos() as f32).collect(),
            sines: (0..size / 2).map(|i| angle(i).sin() as f32).collect(),
            real: vec![0.0; size],
            imaginary: vec![0.0; size],
        }
    }

    /// Replaces the first `size / 2 + 1` values of `signal` (`size` real
    /// samples) with the magnitudes of their frequency bins, 0 to Nyquist.
    pub fn magnitudes(&mut self, signal: &mut [f32]) {
        let size = self.size;
        for (index, &from) in self.reversed.iter().enumerate() {
            self.real[index] = signal[from];
            self.imaginary[index] = 0.0;
        }
        let mut length = 2;
        while length <= size {
            let half = length / 2;
            let stride = size / length;
            for start in (0..size).step_by(length) {
                for k in 0..half {
                    let (cos, sin) = (self.cosines[k * stride], self.sines[k * stride]);
                    let (a, b) = (start + k, start + k + half);
                    let re = self.real[b] * cos - self.imaginary[b] * sin;
                    let im = self.real[b] * sin + self.imaginary[b] * cos;
                    self.real[b] = self.real[a] - re;
                    self.imaginary[b] = self.imaginary[a] - im;
                    self.real[a] += re;
                    self.imaginary[a] += im;
                }
            }
            length *= 2;
        }
        for bin in 0..=size / 2 {
            signal[bin] = self.real[bin].hypot(self.imaginary[bin]);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_a_sine_in_its_bin() {
        let size = 256;
        let mut fft = Fft::new(size);
        let mut signal: Vec<f32> = (0..size)
            .map(|i| (2.0 * PI * 8.0 * i as f64 / size as f64).sin() as f32)
            .collect();
        fft.magnitudes(&mut signal);
        let loudest = (0..=size / 2)
            .max_by(|a, b| signal[*a].total_cmp(&signal[*b]))
            .unwrap();
        assert_eq!(loudest, 8);
        // A unit sine: half its amplitude in each of its two bins.
        assert!(
            (signal[8] - size as f32 / 2.0).abs() < 1e-2,
            "{}",
            signal[8]
        );
    }

    #[test]
    fn a_constant_is_all_in_bin_zero() {
        let mut fft = Fft::new(64);
        let mut signal = vec![0.5; 64];
        fft.magnitudes(&mut signal);
        assert!((signal[0] - 32.0).abs() < 1e-4);
        assert!(signal[1..=32].iter().all(|bin| bin.abs() < 1e-4));
    }
}

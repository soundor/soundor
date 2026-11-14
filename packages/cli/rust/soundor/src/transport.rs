/// The host's transport at the start of a block, as far as the host reports
/// it: a field is `None` when the host does not say.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Transport {
    /// Whether the host's transport is playing.
    pub playing: bool,
    /// The tempo, in beats per minute.
    pub tempo: Option<f64>,
    /// The time signature, as `(numerator, denominator)`.
    pub time_signature: Option<(u32, u32)>,
    /// The position, in seconds from the timeline's start.
    pub time_seconds: Option<f64>,
    /// The position, in quarter notes from the timeline's start.
    pub position_beats: Option<f64>,
}

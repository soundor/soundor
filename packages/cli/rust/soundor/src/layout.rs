/// One of the audio layouts soundor.config supports (`audio.layouts`): the
/// channel counts each bus accepts.
#[derive(Debug, PartialEq, Eq)]
pub struct Layout {
    /// Its name in the config.
    pub name: &'static str,
    /// For each input bus, in the config's order: the channel counts it
    /// accepts (several for an optional bus; 0 when disabled).
    pub inputs: &'static [&'static [usize]],
    /// For each output bus: the channel counts it accepts.
    pub outputs: &'static [&'static [usize]],
}

impl Layout {
    /// Whether an arrangement of `inputs` and `outputs` channels is this one.
    pub fn accepts(&self, inputs: &[usize], outputs: &[usize]) -> bool {
        fn matches(accepted: &[&[usize]], actual: &[usize]) -> bool {
            accepted.len() == actual.len()
                && accepted
                    .iter()
                    .zip(actual)
                    .all(|(choices, count)| choices.contains(count))
        }
        matches(self.inputs, inputs) && matches(self.outputs, outputs)
    }
}

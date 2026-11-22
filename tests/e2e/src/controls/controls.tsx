import { StyleSheet, View } from '@soundor/react';

import { Panel } from '../ui/panel';
import { BypassToggle } from './bypass-toggle';
import { GainSlider } from './gain-slider';
import { ModeChoice } from './mode-choice';
import { NoteField } from './note-field';
import { PresetRow } from './preset-row';

/** The parameters and presets, as a user changes them. */
export function Controls() {
  return (
    <Panel title="Parameters">
      <View style={styles.row}>
        <GainSlider />
        <ModeChoice />
        <BypassToggle />
      </View>
      <PresetRow />
      <View style={styles.row}>
        <NoteField />
      </View>
    </Panel>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 16 },
});

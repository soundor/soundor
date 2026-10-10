// Soundor's rendering benchmark: scenarios for WebGL (Three.js, the expensive
// way and the GPU way, and raw calls), Canvas 2D, UI updates and a mixed
// plugin view, the same code in the JUCE runtime and in the browser. Pick a
// scenario to watch it with live statistics, or run them all for a table of
// results; `pnpm bench` runs them headless in the JUCE runtime.

import {
  Pressable,
  render,
  StyleSheet,
  Text,
  View,
  type StyleProp,
} from '@soundor/react';
import { memo, useEffect, useMemo, useState } from 'react';

import { Driver, type Result } from './driver';
import { GROUPS, SCENARIOS, type Group, type Scenario } from './scenarios';

declare global {
  // For headless runs: soundorBenchmark.run() resolves to the results.
  // `only` limits the run to these groups or scenario ids.
  var soundorBenchmark:
    | {
        run(
          frames?: number,
          warmup?: number,
          only?: readonly string[],
        ): Promise<Result[]>;
      }
    | undefined;
}

function Button({
  label,
  active,
  onPress,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ hovered, pressed }) =>
        [
          styles.button,
          active && styles.buttonActive,
          hovered && styles.buttonHovered,
          pressed && styles.buttonPressed,
        ] as StyleProp
      }
    >
      <Text style={styles.buttonLabel}>{label}</Text>
    </Pressable>
  );
}

/**
 * The running scenario's view. Memoized, so the live statistics re-render
 * the app without re-rendering the scenario.
 */
const StageHost = memo(function StageHost({
  scenario,
  driver,
}: {
  scenario: Scenario;
  driver: Driver;
}) {
  const { Stage } = scenario;
  return (
    <Stage
      key={scenario.stageKey ?? scenario.id}
      scenario={scenario}
      register={driver.register}
    />
  );
});

const format = (value: number, digits = 1) => value.toFixed(digits);

function App() {
  const driver = useMemo(() => new Driver(SCENARIOS[0]!), []);
  const [scenario, setScenario] = useState(SCENARIOS[0]!);
  const [group, setGroup] = useState<Group>(SCENARIOS[0]!.group);
  const [live, setLive] = useState<Result | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    driver.attach(
      (next) => {
        setScenario(next);
        setGroup(next.group);
      },
      () => setLive(driver.result()),
    );
    globalThis.soundorBenchmark = {
      run: async (frames, warmup, only) => {
        const chosen = only
          ? SCENARIOS.filter(
              (each) => only.includes(each.id) || only.includes(each.group),
            )
          : SCENARIOS;
        const all = await driver.runAll(chosen, frames, warmup);
        console.log(`soundor-benchmark ${JSON.stringify(all)}`);
        return all;
      },
    };
    return () => {
      driver.dispose();
      globalThis.soundorBenchmark = undefined;
    };
  }, [driver]);

  const runAll = async () => {
    if (running) return;
    const shown = scenario;
    setRunning(true);
    setResults(await globalThis.soundorBenchmark!.run());
    setRunning(false);
    driver.show(shown);
  };

  return (
    <View style={styles.root}>
      <View style={styles.bar}>
        <Text style={styles.title}>Soundor benchmark</Text>
        {GROUPS.map((each) => (
          <Button
            key={each}
            label={each}
            active={each === group}
            onPress={() => setGroup(each)}
          />
        ))}
        <Button label={running ? 'Running…' : 'Run all'} onPress={runAll} />
      </View>
      <View style={styles.bar}>
        {SCENARIOS.filter((each) => each.group === group).map((each) => (
          <Button
            key={each.id}
            label={each.label}
            active={each.id === scenario.id && !running}
            onPress={() => driver.show(each)}
          />
        ))}
      </View>
      <View style={styles.stage}>
        <StageHost scenario={scenario} driver={driver} />
      </View>
      <Text style={styles.caption}>
        {live && live.scenario === scenario.id
          ? `${scenario.label}: ${scenario.stresses} · ${format(live.fps, 0)} fps · JS ${format(live.scriptAverage)} ms (p95 ${format(live.scriptP95)})${live.drawCalls ? ` · ${live.drawCalls} draw calls` : ''}`
          : `${scenario.label}: ${scenario.stresses}`}
      </Text>
      {results && (
        <View style={styles.table}>
          <Text style={styles.row}>
            {'scenario           fps   JS ms  p95 ms'}
          </Text>
          {results.map((result) => (
            <Text key={result.scenario} style={styles.row}>
              {`${result.scenario.padEnd(16)} ${format(result.fps, 0).padStart(5)} ${format(result.scriptAverage, 2).padStart(7)} ${format(result.scriptP95, 2).padStart(7)}`}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#111317', padding: 16, gap: 10 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  title: { color: '#f2f3f5', fontSize: 16, fontWeight: 'bold', marginRight: 8 },
  button: {
    backgroundColor: '#2a2d35',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  buttonActive: { backgroundColor: '#3b6fd8' },
  buttonHovered: { backgroundColor: '#363a44' },
  buttonPressed: { opacity: 0.7 },
  buttonLabel: { color: '#f2f3f5', fontSize: 12 },
  stage: { width: 640, height: 360, overflow: 'hidden' },
  caption: { color: '#a8adb8', fontSize: 12 },
  table: { backgroundColor: '#1a1d23', borderRadius: 6, padding: 8, gap: 2 },
  row: { color: '#d5d8de', fontSize: 12, fontFamily: 'monospace' },
});

render(<App />);

import { StyleSheet, Text, View } from '@soundor/react';
import { useState } from 'react';

import { Button } from '../ui/button';
import { Field } from '../ui/field';
import { text } from '../ui/theme';

/** Fetches the URL typed in, through the system's HTTP client natively. */
export function FetchForm() {
  const [url, setUrl] = useState('');
  const [result, setResult] = useState('');
  const send = async () => {
    setResult('Fetching');
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from: 'soundor-e2e' }),
      });
      const body = (await response.json()) as { echo?: unknown };
      setResult(`Fetched ${response.status}: ${JSON.stringify(body.echo)}`);
    } catch (error) {
      setResult(`Fetch failed: ${String(error)}`);
    }
  };
  return (
    <>
      <View style={styles.row}>
        <Field label="URL" onChangeText={setUrl} onSubmit={() => void send()} />
        <Button label="Fetch" onPress={() => void send()} />
      </View>
      <Text debugId="fetch.result" style={text.body}>
        {result}
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});

import { StyleSheet, Text, View } from '@soundor/react';
import { useEffect, useState } from 'react';
import { storage } from 'soundor:storage';

import { Button } from '../ui/button';
import { Field } from '../ui/field';
import { text } from '../ui/theme';

const KEY = 'e2e.value';

/** Keeps a value in soundor:storage, which every instance shares. */
export function StorageForm() {
  const [draft, setDraft] = useState('');
  const [stored, setStored] = useState<string | null>(null);
  useEffect(() => {
    void storage.get<string>(KEY).then((value) => setStored(value ?? ''));
  }, []);
  const save = async () => {
    await storage.set(KEY, draft);
    setStored((await storage.get<string>(KEY)) ?? '');
  };
  return (
    <>
      <View style={styles.row}>
        <Field
          label="Value to store"
          onChangeText={setDraft}
          onSubmit={() => void save()}
        />
        <Button label="Store" onPress={() => void save()} />
      </View>
      <Text debugId="storage.value" style={text.body}>
        {stored === null ? 'Stored: loading' : `Stored: ${stored || 'nothing'}`}
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});

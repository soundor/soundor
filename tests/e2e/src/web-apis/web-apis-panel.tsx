import { StyleSheet } from '@soundor/react';

import { Panel } from '../ui/panel';
import { ChecksStatus } from './checks-status';
import { FetchForm } from './fetch-form';
import { StorageForm } from './storage-form';

export function WebApisPanel() {
  return (
    <Panel title="JavaScript and Web APIs" style={styles.fill}>
      <ChecksStatus />
      <FetchForm />
      <StorageForm />
    </Panel>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });

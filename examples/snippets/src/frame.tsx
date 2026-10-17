// Where a snippet shows: centred, with room around it. The docs run each
// snippet in it, alone, and the picker does too.
import { View } from '@soundor/react';
import type { ReactNode } from 'react';

export function Frame({ children }: { readonly children: ReactNode }) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        backgroundColor: '#17181c',
      }}
    >
      {children}
    </View>
  );
}

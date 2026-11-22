import { useState } from 'react';
import { state } from 'soundor:state';

import { Field } from '../ui/field';

/** Sets the note, which the session saves, on Enter. */
export function NoteField() {
  const [draft, setDraft] = useState('');
  return (
    <Field
      label="Note"
      onChangeText={setDraft}
      onSubmit={() => state.note.set(draft)}
    />
  );
}

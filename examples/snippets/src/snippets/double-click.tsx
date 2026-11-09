import { Text, View } from '@soundor/react';
import { useState } from 'react';

// Double-click the strip to add a point where you clicked, and double-click a
// point to remove it. The platform decides what counts as a double click (its
// double-click time); every click says which of a series it is in
// event.detail.
export default function DoubleClick() {
  const [points, setPoints] = useState([60, 200]);
  const [clicks, setClicks] = useState(0);

  return (
    <View style={{ alignItems: 'center', gap: 10 }}>
      <View
        onClick={(event) => setClicks(event.detail)}
        onDoubleClick={(event) => setPoints((all) => [...all, event.locationX])}
        style={{
          width: 280,
          height: 60,
          borderRadius: 8,
          backgroundColor: '#24262c',
        }}
      >
        {points.map((x) => (
          <View
            key={x}
            onDoubleClick={(event) => {
              // The strip's own double click would add one here.
              event.stopPropagation();
              setPoints((all) => all.filter((other) => other !== x));
            }}
            style={{
              position: 'absolute',
              left: x - 8,
              top: 22,
              width: 16,
              height: 16,
              borderRadius: 8,
              backgroundColor: '#9473ca',
            }}
          />
        ))}
      </View>
      <Text style={{ color: '#8b8f98' }}>
        {points.length} points · last click: {clicks || 'none yet'}
      </Text>
    </View>
  );
}

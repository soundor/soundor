import { Text, View } from '@soundor/react';
import { Svg, G, Circle, Path } from '@soundor/react/svg';
import { useState } from 'react';

export default function SvgExample() {
  const [active, setActive] = useState(false);
  return (
    <View style={{ gap: 12, alignItems: 'center' }}>
      <Svg
        width={72}
        height={72}
        viewBox="0 0 24 24"
        accessibilityRole="button"
        accessibilityLabel="Toggle vector status"
        focusable
        onClick={() => setActive((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setActive((value) => !value);
          }
        }}
      >
        <G
          stroke="currentColor"
          color={active ? '#22c55e' : '#38bdf8'}
          strokeWidth={2}
          fill="none"
        >
          <Circle cx={12} cy={12} r={10} />
          {active && (
            <Path
              d="M6 12L10 16L18 8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </G>
      </Svg>
      <Text style={{ color: '#9aa7bd', fontSize: 12 }}>
        Click the vector to update its scene
      </Text>
    </View>
  );
}

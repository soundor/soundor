import { Image, Text, View } from '@soundor/react';
import {
  Svg,
  G,
  Path,
  Circle,
  Rect,
  Line,
  Ellipse,
  Polygon,
  Polyline,
} from '@soundor/react/svg';
import { useState } from 'react';

import check from './assets/check.svg';

function CheckGraphic() {
  return (
    <>
      <Circle cx={12} cy={12} r={10} />
      <Path d="M6 12L10 16L18 8" strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
}
/** An original control whose complete drawing is a retained vector scene. */
function VectorToggle() {
  const [active, setActive] = useState(false);
  const toggle = () => setActive((value) => !value);
  return (
    <Svg
      width={56}
      height={32}
      viewBox="0 0 56 32"
      focusable
      accessibilityRole="togglebutton"
      accessibilityLabel="Vector toggle"
      accessibilityState={{ checked: active }}
      onClick={toggle}
      onKeyDown={(event) => {
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault();
          toggle();
        }
      }}
    >
      <Rect
        width={56}
        height={32}
        rx={16}
        fill={active ? '#22c55e' : '#475569'}
      />
      <Circle cx={active ? 40 : 16} cy={16} r={12} fill="white" />
    </Svg>
  );
}
export function SvgExamples() {
  const [active, setActive] = useState(false);
  return (
    <View style={{ gap: 12 }}>
      <Text style={{ fontSize: 12, color: '#9aa7bd' }}>
        One source for Web and JUCE. Click the status circle or toggle.
      </Text>
      <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
        <Svg
          width={48}
          height={48}
          viewBox="0 0 24 24"
          color={active ? '#22c55e' : '#38bdf8'}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          accessibilityRole="button"
          accessibilityLabel="Change SVG status"
          focusable
          onClick={() => setActive((value) => !value)}
        >
          <CheckGraphic />
        </Svg>
        <VectorToggle />
        <Text style={{ color: 'white', fontSize: 12 }}>
          {active ? 'Active' : 'Ready'}
        </Text>
      </View>
      <Svg
        height={90}
        viewBox="10 20 200 60"
        style={{ width: '100%' }}
        accessibilityLabel="Responsive vector shapes"
      >
        <G
          fill="none"
          stroke="#a78bfa"
          strokeWidth={2}
          transform="translate(10 20)"
        >
          <Rect x={2} y={8} width={28} height={28} rx={6} />
          <G transform="translate(48 22) rotate(25)">
            <Ellipse rx={14} ry={8} />
            <Line x1={-18} x2={18} />
          </G>
          <Polygon points="78,36 94,5 110,36" />
          <Polyline points={[122, 32, 134, 12, 146, 32, 158, 12]} />
          <Path d="M170 32a12 12 0 1 1 24 0" strokeDasharray="3 2" />
        </G>
      </Svg>
      <View style={{ flexDirection: 'row', gap: 20, alignItems: 'center' }}>
        <Image
          source={check}
          accessibilityLabel="Bundled SVG check"
          style={{ width: 36, height: 36, resizeMode: 'contain' }}
        />
        <Svg
          width={36}
          height={36}
          viewBox="0 0 24 24"
          fill="none"
          stroke="#38bdf8"
          strokeWidth={2}
          accessibilityLabel="React SVG check"
        >
          <CheckGraphic />
        </Svg>
        <Text style={{ color: '#9aa7bd', fontSize: 12 }}>
          Image asset / React SVG
        </Text>
      </View>
    </View>
  );
}

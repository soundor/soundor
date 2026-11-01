import { Image } from '@soundor/react';

import landscape from '../assets/landscape.svg';

export default function SvgImage() {
  return (
    <Image
      source={landscape}
      accessibilityLabel="SVG mountain landscape"
      style={{ width: '100%', height: 128, resizeMode: 'contain' }}
    />
  );
}

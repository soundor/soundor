// Every snippet, by the name a docs page gives `<Snippet name>`: its file's.
import type { ComponentType } from 'react';

import Animated from './animated';
import Canvas from './canvas';
import Gain from './gain';
import Modal from './modal';
import Parameters from './parameters';
import Pressable from './pressable';
import Spring from './spring';
import TextInput from './text-input';
import Tooltip from './tooltip';

export const snippets: Readonly<Record<string, ComponentType>> = {
  animated: Animated,
  canvas: Canvas,
  gain: Gain,
  modal: Modal,
  parameters: Parameters,
  pressable: Pressable,
  spring: Spring,
  'text-input': TextInput,
  tooltip: Tooltip,
};

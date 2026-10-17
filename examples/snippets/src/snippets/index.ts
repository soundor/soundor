// Every snippet, by the name a docs page gives `<Snippet name>`: its file's.
import type { ComponentType } from 'react';

import Animated from './animated';
import Canvas from './canvas';
import ContextMenu from './context-menu';
import FocusScope from './focus-scope';
import Gain from './gain';
import Image from './image';
import Modal from './modal';
import Parameters from './parameters';
import Pressable from './pressable';
import ScrollView from './scroll-view';
import Spring from './spring';
import Text from './text';
import TextInput from './text-input';
import Tooltip from './tooltip';
import View from './view';

export const snippets: Readonly<Record<string, ComponentType>> = {
  animated: Animated,
  canvas: Canvas,
  'context-menu': ContextMenu,
  'focus-scope': FocusScope,
  gain: Gain,
  image: Image,
  modal: Modal,
  parameters: Parameters,
  pressable: Pressable,
  'scroll-view': ScrollView,
  spring: Spring,
  text: Text,
  'text-input': TextInput,
  tooltip: Tooltip,
  view: View,
};

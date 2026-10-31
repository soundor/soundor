// Every snippet, by the name a docs page gives `<Snippet name>`: its file's.
import type { ComponentType } from 'react';

import Animated from './animated';
import Canvas from './canvas';
import ContextMenu from './context-menu';
import Cursor from './cursor';
import FocusScope from './focus-scope';
import Gain from './gain';
import Image from './image';
import Modal from './modal';
import Parameters from './parameters';
import PointerLock from './pointer-lock';
import Pressable from './pressable';
import ScrollView from './scroll-view';
import Spring from './spring';
import Text from './text';
import TextInput from './text-input';
import Tooltip from './tooltip';
import View from './view';
import ViewSize from './view-size';

export const snippets: Readonly<Record<string, ComponentType>> = {
  animated: Animated,
  canvas: Canvas,
  'context-menu': ContextMenu,
  cursor: Cursor,
  'focus-scope': FocusScope,
  gain: Gain,
  image: Image,
  modal: Modal,
  parameters: Parameters,
  'pointer-lock': PointerLock,
  pressable: Pressable,
  'scroll-view': ScrollView,
  spring: Spring,
  text: Text,
  'text-input': TextInput,
  tooltip: Tooltip,
  view: View,
  'view-size': ViewSize,
};

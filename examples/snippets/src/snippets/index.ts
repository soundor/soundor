// Every snippet, by the name a docs page gives `<Snippet name>`: its file's.
import type { ComponentType } from 'react';

import Animated from './animated';
import BoxShadow from './box-shadow';
import Canvas from './canvas';
import ContextMenu from './context-menu';
import Cursor from './cursor';
import DoubleClick from './double-click';
import FocusScope from './focus-scope';
import Gain from './gain';
import History from './history';
import Image from './image';
import SvgImage from './image-svg';
import Modal from './modal';
import Parameters from './parameters';
import PointerLock from './pointer-lock';
import Pressable from './pressable';
import Scrolling from './scrolling';
import Spring from './spring';
import Svg from './svg';
import Text from './text';
import TextInput from './text-input';
import Tooltip from './tooltip';
import View from './view';
import ViewSize from './view-size';

export const snippets: Readonly<Record<string, ComponentType>> = {
  animated: Animated,
  'box-shadow': BoxShadow,
  canvas: Canvas,
  'context-menu': ContextMenu,
  cursor: Cursor,
  'double-click': DoubleClick,
  'focus-scope': FocusScope,
  gain: Gain,
  history: History,
  image: Image,
  'image-svg': SvgImage,
  svg: Svg,
  modal: Modal,
  parameters: Parameters,
  'pointer-lock': PointerLock,
  pressable: Pressable,
  scrolling: Scrolling,
  spring: Spring,
  text: Text,
  'text-input': TextInput,
  tooltip: Tooltip,
  view: View,
  'view-size': ViewSize,
};

/**
 * React for Soundor plugin UIs: a renderer for the plugin view (soundor:ui)
 * and its primitives.
 *
 *   import { render, View, Text } from '@soundor/react';
 *   render(<View style={{ padding: 16 }}><Text>Hello</Text></View>);
 */

export type {
  AccessibilityActionEvent,
  AccessibilityActionInfo,
  AccessibilityActionName,
  AccessibilityProps,
  AccessibilityRole,
  AccessibilityState,
  AccessibilityValue,
} from './accessibility';
export {
  Animated,
  type AnimatedViewProps,
  type TimingTransition,
  type SpringTransition,
  type AnimationTransition,
  Canvas,
  Image,
  Pressable,
  Text,
  TextInput,
  View,
  type DebugProps,
  type EventProps,
  type CanvasProps,
  type ImageProps,
  type PressableProps,
  type Style,
  type TextInputProps,
  type TextProps,
  type ViewProps,
} from './components';
export { FocusScope, type FocusScopeProps } from './focus';
export { Modal, type ModalProps } from './modal';
export {
  useAnimationFrame,
  useParameter,
  useStateValue,
  useHistory,
  useViewSize,
  type ParameterLike,
} from './hooks';
export {
  createPortalHost,
  Portal,
  type PortalHost,
  type PortalHostProps,
  type PortalProps,
} from './portal';
export {
  usePressable,
  type PressableHandle,
  type PressableOptions,
  type PressableState,
  type UsePressableOptions,
} from './pressable';
export { useCanvasSize, type CanvasSize } from './canvas-size';
export { createRoot, flushSync, render, type Root } from './root';
export {
  useScrollbar,
  type Scrollbar,
  type ScrollbarOptions,
  type Scrollbars,
} from './scrollbar';
export { StyleSheet, flattenStyle, type StyleProp } from './style';

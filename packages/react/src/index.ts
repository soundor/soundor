/**
 * React for Soundor plugin UIs: a renderer for the plugin view (soundor:ui)
 * and its primitives.
 *
 *   import { render, View, Text } from '@soundor/react';
 *   render(<View style={{ padding: 16 }}><Text>Hello</Text></View>);
 */

export {
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type EventProps,
  type ImageProps,
  type PressableProps,
  type PressableState,
  type ScrollViewProps,
  type Style,
  type TextInputProps,
  type TextProps,
  type ViewProps,
} from './components';
export { FocusScope, type FocusScopeProps } from './focus';
export { useAnimationFrame, useParameter, type ParameterLike } from './hooks';
export {
  createPortalHost,
  Portal,
  type PortalHost,
  type PortalHostProps,
  type PortalProps,
} from './portal';
export { createRoot, flushSync, render, type Root } from './root';
export { StyleSheet, flattenStyle, type StyleProp } from './style';

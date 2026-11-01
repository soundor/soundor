import { createElement, useContext } from 'react';

import { ScopeContext } from '../focus';
import { HostTypes, SCOPE_PROP } from '../host';
import { SvgTypes } from './scene';
import type {
  SvgProps,
  GProps,
  PathProps,
  CircleProps,
  RectProps,
  EllipseProps,
  LineProps,
  PolygonProps,
  PolylineProps,
} from './types';
export type * from './types';
/** A responsive vector viewport. Only this root creates a Soundor UI/Yoga node. */
export function Svg(props: SvgProps) {
  return createElement(HostTypes.Svg, {
    ...props,
    [SCOPE_PROP]: useContext(ScopeContext),
  });
}
/** A logical group with inherited presentation and a local transform. */
export function G(props: GProps) {
  return createElement(SvgTypes.G, props);
}
/** SVG path geometry, parsed and retained by the runtime. */
export function Path(props: PathProps) {
  return createElement(SvgTypes.Path, props);
}
/** A circle in SVG user units. */
export function Circle(props: CircleProps) {
  return createElement(SvgTypes.Circle, props);
}
/** A rectangle with optional rounded corners. */
export function Rect(props: RectProps) {
  return createElement(SvgTypes.Rect, props);
}
/** An ellipse in SVG user units. */
export function Ellipse(props: EllipseProps) {
  return createElement(SvgTypes.Ellipse, props);
}
/** A line between two endpoints. */
export function Line(props: LineProps) {
  return createElement(SvgTypes.Line, props);
}
/** A closed collection of points. */
export function Polygon(props: PolygonProps) {
  return createElement(SvgTypes.Polygon, props);
}
/** An open collection of points. */
export function Polyline(props: PolylineProps) {
  return createElement(SvgTypes.Polyline, props);
}

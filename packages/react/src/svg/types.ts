import type { ReactNode } from 'react';
import type { SvgPresentation, SvgPreserveAspectRatio } from 'soundor:ui';

import type { ViewProps } from '../components';

/** SVG presentation in user units; omitted properties inherit through G. */
export interface PresentationProps extends Omit<
  SvgPresentation,
  'transform' | 'strokeDasharray'
> {
  /** SVG transform list (angles in degrees), or matrix [a,b,c,d,e,f]. */
  transform?:
    | string
    | readonly [number, number, number, number, number, number];
  /** Nonnegative user-unit dash lengths, a numeric list, or 'none'. */
  strokeDasharray?: string | readonly number[];
}
/** One Soundor layout/input/accessibility node containing a vector scene. */
export interface SvgProps extends ViewProps, PresentationProps {
  /** Logical layout width. Root style takes precedence; no editor-scale multiplication. */
  width?: number;
  /** Logical layout height. Root style takes precedence. */
  height?: number;
  /** User-space origin and positive dimensions: 'minX minY width height' or four numbers. */
  viewBox?: string | readonly [number, number, number, number];
  /** ViewBox alignment/scaling; defaults to xMidYMid meet. */
  preserveAspectRatio?: SvgPreserveAspectRatio;
}
export interface GProps extends PresentationProps {
  /** Reconciled vector children; groups have no Yoga node or individual event target. */
  children?: ReactNode;
}
export interface PathProps extends PresentationProps {
  /** Standard SVG path data, including curves and elliptical arcs. */
  d?: string;
}
export interface CircleProps extends PresentationProps {
  /** Center x in user units; defaults to 0. */
  cx?: number;
  /** Center y in user units; defaults to 0. */
  cy?: number;
  /** Nonnegative radius; defaults to 0 (no drawing). */
  r?: number;
}
export interface RectProps extends PresentationProps {
  /** Left edge; defaults to 0. */
  x?: number;
  /** Top edge; defaults to 0. */
  y?: number;
  /** Nonnegative width in user units; defaults to 0. */
  width?: number;
  /** Nonnegative height in user units; defaults to 0. */
  height?: number;
  /** Horizontal corner radius. A single radius supplies the other. */
  rx?: number;
  /** Vertical corner radius. A single radius supplies the other. */
  ry?: number;
}
export interface EllipseProps extends PresentationProps {
  /** Center x; defaults to 0. */
  cx?: number;
  /** Center y; defaults to 0. */
  cy?: number;
  /** Nonnegative horizontal radius; defaults to 0. */
  rx?: number;
  /** Nonnegative vertical radius; defaults to 0. */
  ry?: number;
}
export interface LineProps extends PresentationProps {
  /** Start x; defaults to 0. */
  x1?: number;
  /** Start y; defaults to 0. */
  y1?: number;
  /** End x; defaults to 0. */
  x2?: number;
  /** End y; defaults to 0. */
  y2?: number;
}
export interface PointsProps extends PresentationProps {
  /** Alternating x/y numbers, or an SVG numeric point list. Units are not supported. */
  points?: string | readonly number[];
}
export type PolygonProps = PointsProps;
export type PolylineProps = PointsProps;

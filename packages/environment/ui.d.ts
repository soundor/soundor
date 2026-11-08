// soundor:ui, the plugin view: its node tree, flexbox styles, input events,
// canvases, images and fonts.

declare module 'soundor:ui' {
  /**
   * A bundled image or font: the id an import such as
   * `import logo from './logo.png'` gives, which the runtime resolves.
   */
  export type Asset = string;
  /** Logical pixels (a number, or CSS pixels: '120px'), a percentage of the parent, or (where allowed) 'auto'. */
  export type Dimension = number | `${number}px` | `${number}%` | 'auto';
  export type Percentage = number | `${number}px` | `${number}%`;
  export type TransformOperation =
    | { translateX: number }
    | { translateY: number }
    | { scale: number }
    | { scaleX: number }
    | { scaleY: number }
    | { rotate: number | `${number}deg` | `${number}rad` };
  export type AnimationEasing =
    | 'linear'
    | 'ease'
    | 'ease-in'
    | 'ease-out'
    | 'ease-in-out';
  export interface AnimationKeyframe {
    opacity?: number;
    transform?: readonly TransformOperation[];
    backgroundColor?: string;
    borderColor?: string;
    offset?: number;
    easing?: AnimationEasing;
  }
  export interface AnimationOptions {
    type?: 'timing' | 'spring';
    duration?: number;
    delay?: number;
    easing?: AnimationEasing;
    fill?: 'none' | 'backwards' | 'forwards' | 'both';
    iterations?: number;
    direction?: 'normal' | 'reverse' | 'alternate' | 'alternate-reverse';
    stiffness?: number;
    damping?: number;
    mass?: number;
    initialVelocity?: number;
    restDisplacement?: number;
    restVelocity?: number;
  }
  export type AnimationPlaybackOptions = Pick<
    AnimationOptions,
    'delay' | 'easing' | 'fill' | 'iterations' | 'direction'
  >;
  export interface AnimationEffect {
    kind?: 'effect';
    target?: UiNode;
    keyframes: readonly AnimationKeyframe[];
    options?: AnimationOptions;
  }
  export interface AnimationComposition {
    kind: 'sequence' | 'parallel' | 'stagger';
    children: readonly AnimationDescription[];
    options?: AnimationPlaybackOptions;
    stagger?: number;
  }
  export interface AnimationDelay {
    kind: 'delay';
    duration: number;
  }
  export type AnimationDescription =
    | AnimationEffect
    | AnimationComposition
    | AnimationDelay;
  export interface UiAnimation {
    readonly finished: Promise<void>;
    readonly playState: 'idle' | 'running' | 'paused' | 'finished';
    currentTime: number;
    play(): void;
    pause(): void;
    resume(): void;
    cancel(): void;
    finish(): void;
  }

  export function effect(
    target: UiNode,
    keyframes: readonly AnimationKeyframe[],
    options?: AnimationOptions,
  ): AnimationEffect;
  export function sequence(
    children: readonly AnimationDescription[],
    options?: AnimationPlaybackOptions,
  ): AnimationComposition;
  export function parallel(
    children: readonly AnimationDescription[],
    options?: AnimationPlaybackOptions,
  ): AnimationComposition;
  export function stagger(
    interval: number,
    children: readonly AnimationDescription[],
    options?: AnimationPlaybackOptions,
  ): AnimationComposition;
  export function delay(
    duration: number,
    child?: AnimationDescription,
  ): AnimationDescription;
  export function repeat(
    child: AnimationDescription,
    iterations?: number,
    direction?: AnimationOptions['direction'],
  ): AnimationComposition;
  export function animate(
    description: AnimationDescription,
    options?: AnimationPlaybackOptions,
  ): UiAnimation;

  export function setReducedMotion(value: boolean): void;
  export function prefersReducedMotion(): boolean;

  export type FlexAlign =
    | 'auto'
    | 'flex-start'
    | 'center'
    | 'flex-end'
    | 'stretch'
    | 'baseline'
    | 'space-between'
    | 'space-around'
    | 'space-evenly';

  /**
   * Flexbox layout as in React Native (column by default, no shrinking unless
   * asked) and text properties.
   */
  export interface Style {
    /** 'none': the node takes no room and is not drawn. 'flex' by default. */
    display?: 'flex' | 'none';
    /**
     * 'relative' (the default): laid out by its parent, then offset by
     * top/left/…; 'absolute': out of the flow, placed by top/left/… in its
     * parent's box; 'static': laid out, ignoring the offsets.
     */
    position?: 'relative' | 'absolute' | 'static';
    /** The main axis children are laid out along: 'column' by default. */
    flexDirection?: 'column' | 'column-reverse' | 'row' | 'row-reverse';
    /** Whether children that do not fit wrap onto more lines: 'nowrap' by default. */
    flexWrap?: 'nowrap' | 'wrap' | 'wrap-reverse';
    /** Children along the main axis: 'flex-start' by default. */
    justifyContent?:
      | 'flex-start'
      | 'center'
      | 'flex-end'
      | 'space-between'
      | 'space-around'
      | 'space-evenly';
    /** Children across the main axis: 'stretch' by default. */
    alignItems?: FlexAlign;
    /** This node across its parent's main axis, overriding the parent's alignItems. */
    alignSelf?: FlexAlign;
    /** Wrapped lines across the main axis. */
    alignContent?: FlexAlign;
    /** `flex: n` (n > 0) grows by n, shrinks, and starts from zero. */
    flex?: number;
    /** How much of the free room along the main axis it takes, against its siblings. */
    flexGrow?: number;
    /** How much it gives up when the room runs short: 0 by default, as in React Native. */
    flexShrink?: number;
    /** Its size along the main axis before growing or shrinking. */
    flexBasis?: Dimension;

    /** Logical pixels, a percentage of the parent's, or 'auto' (the content's). */
    width?: Dimension;
    /** Logical pixels, a percentage of the parent's, or 'auto' (the content's). */
    height?: Dimension;
    minWidth?: Percentage;
    minHeight?: Percentage;
    maxWidth?: Percentage;
    maxHeight?: Percentage;
    /**
     * Width divided by height: one given, the other follows, over a stretch.
     * With both given, the one along the parent's direction stays.
     */
    aspectRatio?: number;
    /** Whether width and height include the padding and border. */
    boxSizing?: 'border-box' | 'content-box';

    /** Room outside the border, on every side; 'auto' takes the free room (centring). */
    margin?: Dimension;
    marginHorizontal?: Dimension;
    marginVertical?: Dimension;
    marginTop?: Dimension;
    marginRight?: Dimension;
    marginBottom?: Dimension;
    marginLeft?: Dimension;
    /** Room inside the border, around the children, on every side. */
    padding?: Percentage;
    paddingHorizontal?: Percentage;
    paddingVertical?: Percentage;
    paddingTop?: Percentage;
    paddingRight?: Percentage;
    paddingBottom?: Percentage;
    paddingLeft?: Percentage;
    /** The border's width on every side, in logical pixels; borderColor paints it. */
    borderWidth?: number;
    borderHorizontalWidth?: number;
    borderVerticalWidth?: number;
    borderTopWidth?: number;
    borderRightWidth?: number;
    borderBottomWidth?: number;
    borderLeftWidth?: number;
    /** top, right, bottom and left at once. */
    inset?: Dimension;
    /** The offset of a 'relative' node, or the place of an 'absolute' one. */
    top?: Dimension;
    right?: Dimension;
    bottom?: Dimension;
    left?: Dimension;
    /** Room between children, in logical pixels: rows and columns. */
    gap?: number;
    rowGap?: number;
    columnGap?: number;

    /**
     * What happens to children that reach past the box, on both axes:
     * 'visible' (the default) shows them, 'hidden' clips them to the box,
     * and 'scroll' clips them and scrolls them (a wheel, a scrollbar,
     * `scrollTo()`). Only a view's children scroll: on other nodes 'scroll'
     * clips, as 'hidden'.
     */
    overflow?: 'visible' | 'hidden' | 'scroll';
    /**
     * `overflow` along one axis, over `overflow` whatever the order. A box
     * clips both axes or neither: 'visible' next to a clipping axis clips
     * too, as 'hidden'. `{ overflowX: 'scroll' }` is a strip that scrolls
     * sideways.
     */
    overflowX?: 'visible' | 'hidden' | 'scroll';
    /** `overflow` along the vertical axis: see `overflowX`. */
    overflowY?: 'visible' | 'hidden' | 'scroll';
    /** 'box-none': not the node, but its children; 'box-only': the reverse. */
    pointerEvents?: 'auto' | 'none' | 'box-none' | 'box-only';
    /**
     * The pointer's shape over the node and its children, unless one of them
     * sets its own: 'auto' (the default) takes the parent's, and is the
     * arrow ('default') at the root and the I-beam ('text') in a text input.
     * While a pointer is pressed, the pressed node's shows wherever it is
     * dragged. 'none' hides the pointer.
     */
    cursor?:
      | 'auto'
      | 'default'
      | 'none'
      | 'pointer'
      | 'text'
      | 'crosshair'
      | 'move'
      | 'ew-resize'
      | 'ns-resize'
      | 'nesw-resize'
      | 'nwse-resize';
    /**
     * An integer that stacks the node among its siblings: higher ones are
     * drawn over, and hit before, lower ones; equal ones keep tree order (the
     * later sibling on top). Not layout: flex order stays the tree's. 0 by
     * default.
     */
    zIndex?: number;

    /**
     * One font family, by name: one registered with registerFont(), else
     * one installed on the system (or 'serif', 'monospace'…). The
     * platform's UI font by default.
     */
    fontFamily?: string;
    /** In logical pixels. */
    fontSize?: number;
    /** 100 to 900, 'normal' (400) or 'bold' (700). */
    fontWeight?: number | 'normal' | 'bold';
    fontStyle?: 'normal' | 'italic';
    /** The height of a line, in logical pixels. */
    lineHeight?: number;
    /** Extra room between letters, in logical pixels. */
    letterSpacing?: number;
    textAlign?: 'auto' | 'left' | 'center' | 'right';
    /** Text nodes: at most this many lines (0: no limit). */
    numberOfLines?: number;
    /** The text's color: any CSS color. */
    color?: Color;

    /** Any CSS color: '#rgb[a]', '#rrggbb[aa]', rgb(), hsl(), a name, 'transparent'. */
    backgroundColor?: Color;
    /** The border's color: any CSS color. */
    borderColor?: Color;
    /** Rounds the corners, in logical pixels. */
    borderRadius?: number;
    borderTopLeftRadius?: number;
    borderTopRightRadius?: number;
    borderBottomRightRadius?: number;
    borderBottomLeftRadius?: number;
    /**
     * A line around the node, in logical pixels, drawn outside its border
     * and following its corners, as CSS's `outline`: it takes no room in
     * layout and is not hit. 0 (the default) draws none.
     */
    outlineWidth?: number;
    /** The outline's color: any CSS color. Black by default. */
    outlineColor?: Color;
    /**
     * How far the outline is from the border, in logical pixels: 0 by
     * default, inside the node when negative.
     */
    outlineOffset?: number;
    /** 0 to 1, for the node and everything in it. */
    opacity?: number;
    /**
     * Moves, scales and rotates how the node is drawn (and hit), about its
     * centre, in order; layout is unchanged.
     */
    transform?: readonly TransformOperation[];
    /** Images: how the image fills the box. */
    resizeMode?: 'cover' | 'contain' | 'stretch' | 'center';
  }

  /** A CSS color string. */
  export type Color = string;

  export interface LayoutRect {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  }

  /**
   * What a node is to assistive technology (`accessibilityRole` in
   * @soundor/react). 'none': no role of its own.
   */
  export type AccessibilityRole =
    | 'none'
    | 'text'
    | 'image'
    | 'button'
    | 'link'
    | 'adjustable'
    | 'checkbox'
    | 'switch'
    | 'togglebutton'
    | 'radio'
    | 'radiogroup'
    | 'progressbar'
    | 'search'
    | 'combobox'
    | 'menu'
    | 'menubar'
    | 'menuitem'
    | 'scrollbar'
    | 'spinbutton'
    | 'tab'
    | 'tablist'
    | 'header'
    | 'summary'
    | 'keyboardkey'
    | 'timer'
    | 'toolbar'
    | 'alert'
    | 'dialog';

  export interface AccessibilityState {
    disabled?: boolean;
    selected?: boolean;
    /** 'mixed': partly checked. */
    checked?: boolean | 'mixed';
    busy?: boolean;
    expanded?: boolean;
  }

  /** A range's value (fractional values welcome), and how to read it. */
  export interface AccessibilityValue {
    min?: number;
    max?: number;
    now?: number;
    /** Read in place of the number: '-3.5 dB'. */
    text?: string;
  }

  /**
   * The actions the runtime knows; any other name is a custom action, offered
   * to the user by its label.
   */
  export type AccessibilityActionName =
    | 'activate'
    | 'increment'
    | 'decrement'
    | 'longpress'
    | 'expand'
    | 'collapse'
    | 'escape'
    | 'focus'
    | 'blur'
    | 'setValue'
    | (string & {});

  export interface AccessibilityAction {
    name: AccessibilityActionName;
    /** How a custom action is presented. */
    label?: string;
  }

  /**
   * What a node is to assistive technology (screen readers and the like).
   * The runtime fills in the rest from the node: its type, its text, whether
   * it is focusable, and where it is.
   */
  export interface Accessibility {
    /**
     * true: the node is an element assistive technology perceives; false: it
     * is not (its descendants still may be). By default, text nodes and
     * inputs are, and so is a node given a role or a label.
     */
    accessible?: boolean;
    role?: AccessibilityRole;
    label?: string;
    /** What happens when the element is acted on. */
    hint?: string;
    state?: AccessibilityState;
    value?: AccessibilityValue;
    /** The actions it responds to, as `accessibilityaction` events. */
    actions?: readonly AccessibilityAction[];
    /**
     * While shown, assistive technology perceives only this element and what
     * it holds (the last such element shown, when there are several).
     */
    modal?: boolean;
  }

  export interface UiEventMap {
    pointerdown: PointerEvent;
    pointermove: PointerEvent;
    pointerup: PointerEvent;
    pointercancel: PointerEvent;
    pointerenter: PointerEvent;
    pointerleave: PointerEvent;
    click: PointerEvent;
    /** The secondary button went down (or the platform's equivalent). */
    contextmenu: PointerEvent;
    wheel: WheelEvent;
    keydown: KeyboardEvent;
    keyup: KeyboardEvent;
    beforeinput: InputEvent;
    focus: FocusEvent;
    blur: FocusEvent;
    /**
     * The node's `focusVisible` changed: when it takes focus that is shown,
     * loses it, or shows it after a key press. Does not bubble.
     */
    focusvisiblechange: FocusEvent;
    /** Scroll views: the content scrolled. */
    scroll: Event;
    /** Text inputs: the value changed. */
    input: InputEvent;
    /** Text inputs: the value was committed (Enter, or losing focus). */
    change: Event;
    /**
     * Assistive technology asks for an action. Bubbles; preventDefault()
     * says it was done, and keeps the runtime's own response (focusing, an
     * input's text) away.
     */
    accessibilityaction: AccessibilityActionEvent;
  }

  /** Presentation in SVG user units, independent of Soundor's layout Style. */
  export interface SvgPresentation {
    /** Fill paint; defaults to black. */
    fill?: string;
    /** Stroke paint; defaults to none. */
    stroke?: string;
    /** Inherited color used by currentColor; defaults to black. */
    color?: string;
    /** Stroke width in SVG user units; defaults to 1. Zero draws no stroke. */
    strokeWidth?: number;
    /** Fill winding rule; defaults to nonzero. */
    fillRule?: 'nonzero' | 'evenodd';
    /** Stroke endpoint shape; defaults to butt. */
    strokeLinecap?: 'butt' | 'round' | 'square';
    /** Stroke join shape; defaults to miter. */
    strokeLinejoin?: 'miter' | 'round' | 'bevel';
    /** Miter limit, at least 1; defaults to 4. */
    strokeMiterlimit?: number;
    /** Nonnegative dash lengths; an odd list repeats, all-zero means solid. */
    strokeDasharray?: readonly number[];
    /** Signed dash offset in SVG user units. */
    strokeDashoffset?: number;
    /** Isolated opacity of this shape/group, not inherited; defaults to 1. */
    opacity?: number;
    /** Inherited fill opacity; defaults to 1. */
    fillOpacity?: number;
    /** Inherited stroke opacity; defaults to 1. */
    strokeOpacity?: number;
    /** Local affine matrix [a,b,c,d,e,f]. */
    transform?: readonly [number, number, number, number, number, number];
  }
  export type SvgAlignment =
    `x${'Min' | 'Mid' | 'Max'}Y${'Min' | 'Mid' | 'Max'}`;
  export type SvgPreserveAspectRatio =
    | 'none'
    | SvgAlignment
    | `${SvgAlignment} ${'meet' | 'slice'}`;
  /** Retained geometry. Only groups contain shapes; none create UI nodes. */
  export type SvgShape = { readonly presentation?: SvgPresentation } & (
    | { readonly type: 'g'; readonly children?: readonly SvgShape[] }
    | { readonly type: 'path'; readonly d?: string }
    | {
        readonly type: 'circle';
        readonly cx?: number;
        readonly cy?: number;
        readonly r?: number;
      }
    | {
        readonly type: 'rect';
        readonly x?: number;
        readonly y?: number;
        readonly width?: number;
        readonly height?: number;
        readonly rx?: number;
        readonly ry?: number;
      }
    | {
        readonly type: 'ellipse';
        readonly cx?: number;
        readonly cy?: number;
        readonly rx?: number;
        readonly ry?: number;
      }
    | {
        readonly type: 'line';
        readonly x1?: number;
        readonly y1?: number;
        readonly x2?: number;
        readonly y2?: number;
      }
    | {
        readonly type: 'polyline' | 'polygon';
        readonly points?: readonly number[];
      }
  );
  /** Atomic scene protocol v1, requiring @soundor/engine 0.6.0 or later. */
  export interface SvgScene {
    readonly version: 1;
    /** User-space origin and positive dimensions, independent of Yoga. */
    readonly viewBox?: readonly [number, number, number, number];
    /** ViewBox mapping; defaults to xMidYMid meet. */
    readonly preserveAspectRatio?: SvgPreserveAspectRatio;
    /** Root presentation, inherited by its shapes. */
    readonly presentation?: SvgPresentation;
    readonly children: readonly SvgShape[];
  }

  /** 'smooth' scrolls over a moment; 'auto' and 'instant', at once. */
  export type ScrollBehavior = 'auto' | 'instant' | 'smooth';
  export interface ScrollToOptions {
    top?: number;
    left?: number;
    /** 'auto' by default: at once. */
    behavior?: ScrollBehavior;
  }
  /** Where in a view: its start, its middle, its end, or no further than it takes. */
  export type ScrollLogicalPosition = 'start' | 'center' | 'end' | 'nearest';
  export interface ScrollIntoViewOptions {
    /** Along the vertical axis; 'start' by default. */
    block?: ScrollLogicalPosition;
    /** Along the horizontal axis; 'nearest' by default. */
    inline?: ScrollLogicalPosition;
    behavior?: ScrollBehavior;
  }
  /**
   * A node of the view: a flexbox box ('view'), text, an image, a text input,
   * a canvas or an SVG viewport. Views scroll when their style says so.
   * Events capture and bubble along the tree as in the DOM.
   */
  export class UiNode extends EventTarget {
    private constructor();
    readonly type: 'view' | 'text' | 'image' | 'input' | 'canvas' | 'svg';
    readonly parent: UiNode | null;
    readonly children: readonly UiNode[];
    readonly firstChild: UiNode | null;
    readonly lastChild: UiNode | null;
    readonly nextSibling: UiNode | null;
    readonly previousSibling: UiNode | null;
    /** Whether the node is in the view's trees (under root or overlayRoot). */
    readonly isConnected: boolean;
    /** The style: assigned as a whole, or one property at a time (`node.style.width = 120`). */
    style: Style;
    /** Atomically replaces a validated vector scene; null clears it. SVG nodes only. */
    setSvgScene(scene: SvgScene | null): void;
    /** Text nodes only. */
    text: string;
    /** What the node is to assistive technology; replaced as a whole on assignment. */
    accessibility: Readonly<Accessibility>;
    /**
     * Where assistive technology reads the node, in place of its parent
     * (null: its parent): content a portal shows away from where it belongs.
     */
    accessibilityParent: UiNode | null;
    /**
     * The name developer tools (DevTools, Soundor Driver) find the node by;
     * empty for none, at most 128 characters. Not shown, nor read to
     * assistive technology.
     */
    debugId: string;
    /** Whether the node takes focus when pressed or tabbed to. */
    focusable: boolean;
    readonly focused: boolean;
    /**
     * Whether it has focus and should show it, as CSS's `:focus-visible`:
     * not when a pointer press gave it focus, until a key is pressed (a
     * text input always shows it). Draw a focus ring for this, not
     * `focused`.
     */
    readonly focusVisible: boolean;
    focus(): void;
    blur(): void;
    /**
     * Locks the pointer pressing this node (or a node in it) to it for the
     * press: hidden, not stopped by the screen's edges, its events at the
     * position the lock began, with movementX/Y saying how far it moved. Ends
     * with the release or exitPointerLock(); the pointer shows again where it
     * began. Call it from pointerdown (the browser needs the press to allow
     * it). Rejects with a NotAllowedError when no mouse or pen is pressing the
     * node, or the browser refuses (the press goes on, unlocked).
     */
    requestPointerLock(): Promise<void>;
    appendChild<T extends UiNode>(child: T): T;
    insertBefore<T extends UiNode>(child: T, before: UiNode | null): T;
    removeChild<T extends UiNode>(child: T): T;
    remove(): void;
    contains(other: UiNode | null): boolean;
    /** The laid-out box, relative to the parent's (scrolling aside). */
    readonly layout: LayoutRect;
    /**
     * The laid-out box relative to the view's top-left corner, where it shows
     * once its ancestors have scrolled. Zero when not connected.
     */
    getBoundingClientRect(): LayoutRect;
    animate(
      keyframes: readonly AnimationKeyframe[] | AnimationDescription,
      options?: AnimationOptions,
    ): UiAnimation;

    /** Text inputs: the text. Setting it puts the caret at the end. */
    value: string;
    /** Text inputs: shown while empty. */
    placeholder: string;
    /** Text inputs: the selection, in UTF-16 indices (like the Web). */
    readonly selectionStart: number;
    readonly selectionEnd: number;
    readonly selectionDirection: 'forward' | 'backward';
    setSelectionRange(
      start: number,
      end: number,
      direction?: 'forward' | 'backward',
    ): void;
    select(): void;

    /** Images: the bundled image shown (an imported asset). */
    source: Asset;

    /**
     * Canvases: the drawing buffer's size in pixels (300 by 150 to begin
     * with), shown stretched over the box. Setting either clears the canvas.
     */
    width: number;
    height: number;
    /**
     * Canvases: the drawing context, the same object every time; null for a
     * type the canvas cannot have (another than the one it has).
     */
    getContext(
      type: '2d',
      options?: CanvasRenderingContext2DSettings,
    ): CanvasRenderingContext2D | null;
    /** On the GPU; null where there is no acceptable GPU. */
    getContext(
      type: 'webgl2',
      options?: WebGLContextAttributes,
    ): WebGL2RenderingContext | null;
    getContext(type: string, options?: unknown): null;

    /**
     * How far a view that scrolls has its children scrolled (0 on an axis it
     * does not scroll), and their extent. Setting them scrolls at once.
     */
    scrollTop: number;
    scrollLeft: number;
    readonly scrollWidth: number;
    readonly scrollHeight: number;
    /** How much of `scrollWidth` and `scrollHeight` shows: its content box. */
    readonly clientWidth: number;
    readonly clientHeight: number;
    /**
     * Whether a view that scrolls draws its own indicators; true by default.
     * Without them it scrolls just the same, and nothing is in the way at its
     * edges.
     */
    scrollIndicators: boolean;
    /**
     * Scrolls along the axes its style scrolls, clamped to the content;
     * nothing on a node that does not scroll. `behavior: 'smooth'` takes a
     * moment (unless reduced motion is asked for), and a wheel, a scrollbar
     * or scrolling it again stops it where it is.
     */
    scrollTo(options: ScrollToOptions): void;
    scrollTo(left: number, top: number): void;
    /** As `scrollTo()`, by an amount from where it is. */
    scrollBy(options: ScrollToOptions): void;
    scrollBy(left: number, top: number): void;
    /**
     * Scrolls each view around it that scrolls to show it, innermost first:
     * `true` (the default) puts it at their start, `false` at their end.
     * By layout boxes: a transform does not move what it scrolls to.
     */
    scrollIntoView(arg?: boolean | ScrollIntoViewOptions): void;
    addEventListener<K extends keyof UiEventMap>(
      type: K,
      listener: (this: UiNode, event: UiEventMap[K]) => void,
      options?: boolean | AddEventListenerOptions,
    ): void;
    addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ): void;
    removeEventListener<K extends keyof UiEventMap>(
      type: K,
      listener: (this: UiNode, event: UiEventMap[K]) => void,
      options?: boolean | { capture?: boolean },
    ): void;
    removeEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | { capture?: boolean },
    ): void;
  }

  /** The view's root node; it always fills the view. */
  export const root: UiNode;
  /**
   * The view's overlay layer: a second root that fills the view, laid out
   * apart from root, drawn over root and everything in it (whatever their
   * zIndex) and hit before it. Where nothing in it takes pointer events,
   * they reach root. Events in it bubble up to it, not to root. Renderers
   * build overlays on it (@soundor/react's Portal).
   */
  export const overlayRoot: UiNode;
  export function createView(style?: Style): UiNode;
  export function createText(text?: string, style?: Style): UiNode;
  /** An image showing a bundled asset (`import logo from './logo.png'`). */
  export function createImage(source?: Asset, style?: Style): UiNode;
  /** A single-line text input; it is focusable and edits itself. */
  export function createTextInput(options?: {
    value?: string;
    placeholder?: string;
    style?: Style;
  }): UiNode;
  /**
   * A canvas: pixels code draws with getContext('2d') or getContext('webgl2'). Its box is its
   * drawing buffer's size in logical pixels unless its style sizes it.
   */
  export function createCanvas(style?: Style): UiNode;
  /** A layout leaf with a retained vector scene. Shapes have no layout/input nodes. */
  export function createSvg(style?: Style): UiNode;

  // The canvas classes, which are globals too, as on the Web.
  export type CanvasRenderingContext2D = globalThis.CanvasRenderingContext2D;
  export const CanvasRenderingContext2D: typeof globalThis.CanvasRenderingContext2D;
  export type CanvasGradient = globalThis.CanvasGradient;
  export const CanvasGradient: typeof globalThis.CanvasGradient;
  export type CanvasPattern = globalThis.CanvasPattern;
  export const CanvasPattern: typeof globalThis.CanvasPattern;
  export type ImageData = globalThis.ImageData;
  export const ImageData: typeof globalThis.ImageData;
  export type TextMetrics = globalThis.TextMetrics;
  export const TextMetrics: typeof globalThis.TextMetrics;
  export type WebGL2RenderingContext = globalThis.WebGL2RenderingContext;
  export const WebGL2RenderingContext: typeof globalThis.WebGL2RenderingContext;

  export interface PressableState {
    readonly pressed: boolean;
    readonly hovered: boolean;
    readonly focused: boolean;
    /** It has focus and should show it (UiNode.focusVisible). */
    readonly focusVisible: boolean;
  }
  export interface PressableHandlers {
    /**
     * A click (primary button released over the node), Enter/Space while
     * focused, or assistive technology's 'activate'. Not after a long press,
     * when onLongPress is given.
     */
    onPress?: (
      event: PointerEvent | KeyboardEvent | AccessibilityActionEvent,
    ) => void;
    /**
     * The primary button stayed down `delayLongPress` ms, without moving
     * away (with the pointerdown event), or assistive technology's 'longpress'.
     */
    onLongPress?: (event: PointerEvent | AccessibilityActionEvent) => void;
    /** Milliseconds before a press is a long press: 500 by default. */
    delayLongPress?: number;
    onPressIn?: (event: PointerEvent) => void;
    onPressOut?: (event: PointerEvent) => void;
    onHoverIn?: (event: PointerEvent) => void;
    onHoverOut?: (event: PointerEvent) => void;
    onStateChange?: (state: PressableState) => void;
  }
  /** Makes a node pressable (and focusable); returns a function that undoes it. */
  export function pressable(
    node: UiNode,
    handlers?: PressableHandlers,
  ): () => void;

  /** The system clipboard's text. */
  export const clipboard: {
    readText(): Promise<string>;
    writeText(text: string): Promise<void>;
  };
  /** Ends the pointer lock, if any: the pointer shows again where it began. */
  export function exitPointerLock(): void;
  /** The node holding the pointer lock, if any. */
  export function pointerLockNode(): UiNode | null;
  /** The node that has keyboard focus, if any. */
  export function focusedNode(): UiNode | null;
  /**
   * The plugin view's size: what it is laid out at, its pixel density, and
   * the part of it that is always shown.
   */
  export interface ViewSize {
    /** Width in logical pixels (the units of styles and pointer positions). */
    readonly width: number;
    /** Height in logical pixels. */
    readonly height: number;
    /**
     * Device pixels per logical pixel: the display's density, times any
     * scaling the host applies (an editor that scales, a web host scaling a
     * view down to fit a page).
     */
    readonly scale: number;
    /**
     * The part of the view always shown whole, in logical pixels relative to
     * the view's top-left corner: the whole view, unless the editor is
     * resizable with `fit: 'cover'` (soundor.config) and its window is one
     * it was not made for: larger than its maximum, or, scaling, of another
     * shape than its layout. Then the view covers the whole window and this
     * is the part made for (at most the maximum, or the configured
     * `width`×`height` when it scales), centred, the rest being room the UI
     * may draw in. Fractional where the zoom makes it so.
     */
    readonly safeArea: LayoutRect;
  }
  /**
   * The view's size in logical pixels, device pixels per logical pixel and
   * its safe area. The same frozen object until one of them changes, so it
   * works as a store snapshot (`useSyncExternalStore(subscribeViewSize,
   * viewSize)`). Before the host has given the view a size, width and height
   * may be 0.
   */
  export function viewSize(): ViewSize;
  /**
   * Calls `listener` with the new {@link viewSize} once whenever the view's
   * size, scale or safe area changes: when the user resizes the editor (or
   * its iframe), or it moves to a display of another density. Never for an
   * unchanged size, and not every frame. Returns a function that
   * unsubscribes.
   */
  export function subscribeViewSize(
    listener: (size: ViewSize) => void,
  ): () => void;

  /**
   * The editor the view is shown in: the plugin's window in a DAW or the
   * Standalone, the plugin viewport on the Web host's page. Its size is the
   * view's in layout mode; an editor that scales draws its view at another
   * (the view's size times its zoom), and with `fit: 'contain'` letterboxes
   * it where the window has another shape.
   */
  export interface EditorSize {
    /** The editor's actual width, in its logical pixels (before display density). */
    readonly width: number;
    /** The editor's actual height, in its logical pixels. */
    readonly height: number;
    /**
     * Whether {@link requestEditorSize} can ask for another size: true for a
     * resizable editor (soundor.config) whose limits allow one, in a DAW,
     * the Standalone and the Web host's page; false for a fixed editor, and
     * where its container owns its size (a Web build opened with `?embed`).
     * A UI hides its own resize grip where it is false. It says the editor
     * may be asked, not that the host will agree.
     */
    readonly resizable: boolean;
  }
  /**
   * The editor's actual size, in whole logical pixels, and whether it can be
   * asked for another. The same frozen object until either changes, so it
   * works as a store snapshot
   * (`useSyncExternalStore(subscribeEditorSize, editorSize)`). Before the
   * host has shown the editor, width and height are 0.
   */
  export function editorSize(): EditorSize;
  /**
   * Asks for the editor to be `width`×`height`, in its logical pixels (the
   * units of {@link editorSize}, before display density, not the layout's
   * of an editor that scales), rounded to whole pixels. Any finite size can
   * be asked for: it is held to the editor's limits (soundor.config), each
   * side within its minimum and maximum, or for an editor that scales
   * keeping its aspect ratio, its configured size times one zoom: the size
   * at its ratio nearest to the one asked for (asking for one side changes
   * both, by less), within the zooms the limits allow, whatever the current
   * size is. On the Web host's page, also no larger than the room the page
   * has, unless it is already; in a DAW, also within a minimum or maximum
   * of its own the host showed, by giving another size in place of one
   * asked for (Ardour's window is no narrower than its toolbar).
   *
   * Returns that size: the one asked of the host. Null where none can be
   * (`editorSize().resizable` is false: a fixed editor, limits that allow
   * one size, the Web host's `?embed`). It is not the size the editor gets:
   * the editor resizes after the calling code returns, to the size the host
   * gives it, which may be another or none, and {@link subscribeEditorSize}
   * tells of it; editorSize() is the old size until then. Throws a
   * TypeError when a side is not a number, a RangeError when it is not
   * finite.
   */
  export function requestEditorSize(
    width: number,
    height: number,
  ): { readonly width: number; readonly height: number } | null;
  /**
   * Calls `listener` with the new {@link editorSize} once whenever the
   * editor's size changes, whoever resized it: the user, the DAW, the Web
   * host's page or a {@link requestEditorSize}. Never for an unchanged size,
   * and not every frame. Returns a function that unsubscribes.
   */
  export function subscribeEditorSize(
    listener: (size: EditorSize) => void,
  ): () => void;

  export interface FontDescriptors {
    /** The weight the file is, 1 to 1000, 'normal' (400, the default) or 'bold' (700). */
    weight?: number | 'normal' | 'bold';
    /** Whether the file is italic: 'normal' by default. */
    style?: 'normal' | 'italic';
  }
  /**
   * Makes a bundled font file (`import inter from './Inter.ttf'`, TrueType
   * or OpenType) a face of `family`, as CSS's @font-face does: text whose
   * fontFamily is `family` is set in its registered faces, never in an
   * installed font of that name: the face closest to its weight and style
   * (bold and italic are synthesized when no face is). A character the faces
   * lack is drawn in a system font that has it, so a font with Latin
   * glyphs only shows Cyrillic text in another font. Text already shown is
   * laid out again. Resolves once the font is
   * ready; rejects if the file is not a font. Throws a TypeError for invalid
   * arguments.
   */
  export function registerFont(
    family: string,
    source: Asset,
    descriptors?: FontDescriptors,
  ): Promise<void>;

  interface ModifierEventInit extends EventInit {
    shiftKey?: boolean;
    ctrlKey?: boolean;
    altKey?: boolean;
    metaKey?: boolean;
  }
  interface ModifierState {
    readonly shiftKey: boolean;
    readonly ctrlKey: boolean;
    readonly altKey: boolean;
    readonly metaKey: boolean;
    getModifierState(
      key: 'Shift' | 'Control' | 'Alt' | 'Meta' | (string & {}),
    ): boolean;
  }

  export interface PointerEventInit extends ModifierEventInit {
    clientX?: number;
    clientY?: number;
    offsetX?: number;
    offsetY?: number;
    screenX?: number;
    screenY?: number;
    movementX?: number;
    movementY?: number;
    button?: number;
    buttons?: number;
    pointerId?: number;
    pointerType?: 'mouse' | 'pen' | 'touch' | '';
    pressure?: number;
    isPrimary?: boolean;
    relatedTarget?: UiNode | null;
  }
  export class PointerEvent extends Event implements ModifierState {
    constructor(type: string, init?: PointerEventInit);
    readonly shiftKey: boolean;
    readonly ctrlKey: boolean;
    readonly altKey: boolean;
    readonly metaKey: boolean;
    getModifierState(key: string): boolean;
    /** Relative to the view's top-left corner, in logical pixels. */
    readonly pageX: number;
    readonly pageY: number;
    /** Relative to the target's box, in logical pixels. */
    readonly locationX: number;
    readonly locationY: number;
    /** pageX and pageY, by their Web names. */
    readonly clientX: number;
    readonly clientY: number;
    readonly x: number;
    readonly y: number;
    /** locationX and locationY, by their Web names. */
    readonly offsetX: number;
    readonly offsetY: number;
    /**
     * Where the pointer is on the screen, in the editor's logical pixels
     * (the units of editorSize() and requestEditorSize()). Unlike clientX/Y,
     * they do not change when the editor is resized, or zoomed when it
     * scales, so a drag that resizes the editor measures its distance with
     * them: the size at the press plus how far screenX/Y moved since. Where
     * a runtime cannot tell (a wheel event, a simulated one), clientX/Y.
     */
    readonly screenX: number;
    readonly screenY: number;
    /**
     * How far the pointer moved since its previous event, in logical pixels;
     * also while locked, when clientX/Y stay where the lock began.
     */
    readonly movementX: number;
    readonly movementY: number;
    /** The button that changed: 0 primary, 1 middle, 2 secondary; -1 none. */
    readonly button: number;
    /** Buttons held: 1 primary, 2 secondary, 4 middle. */
    readonly buttons: number;
    readonly pointerId: number;
    readonly pointerType: 'mouse' | 'pen' | 'touch' | '';
    readonly pressure: number;
    readonly isPrimary: boolean;
    readonly relatedTarget: UiNode | null;
    readonly target: UiNode | null;
    readonly currentTarget: UiNode | null;
  }

  export interface WheelEventInit extends PointerEventInit {
    deltaX?: number;
    deltaY?: number;
    deltaMode?: 0 | 1 | 2;
  }
  export class WheelEvent extends PointerEvent {
    constructor(type: string, init?: WheelEventInit);
    /** Positive scrolls right. */
    readonly deltaX: number;
    /** Positive scrolls down. */
    readonly deltaY: number;
    readonly deltaZ: number;
    /** 0: pixels, 1: lines, 2: pages. */
    readonly deltaMode: 0 | 1 | 2;
    static readonly DOM_DELTA_PIXEL: 0;
    static readonly DOM_DELTA_LINE: 1;
    static readonly DOM_DELTA_PAGE: 2;
  }

  export interface KeyboardEventInit extends ModifierEventInit {
    key?: string;
    repeat?: boolean;
  }
  export class KeyboardEvent extends Event implements ModifierState {
    constructor(type: string, init?: KeyboardEventInit);
    readonly shiftKey: boolean;
    readonly ctrlKey: boolean;
    readonly altKey: boolean;
    readonly metaKey: boolean;
    getModifierState(key: string): boolean;
    /** The character, or a named key: 'Enter', 'ArrowLeft', 'Backspace'... */
    readonly key: string;
    readonly repeat: boolean;
    readonly target: UiNode | null;
    readonly currentTarget: UiNode | null;
  }

  export class FocusEvent extends Event {
    constructor(
      type: string,
      init?: EventInit & {
        relatedTarget?: UiNode | null;
        focusVisible?: boolean;
      },
    );
    readonly relatedTarget: UiNode | null;
    /** Whether the target shows its focus now (UiNode.focusVisible). */
    readonly focusVisible: boolean;
    readonly target: UiNode | null;
    readonly currentTarget: UiNode | null;
  }

  export class AccessibilityActionEvent extends Event {
    constructor(
      type: string,
      init?: EventInit & { actionName?: string; value?: number | string },
    );
    /** 'activate', 'increment', 'setValue'..., or a custom action's name. */
    readonly actionName: AccessibilityActionName;
    /** setValue: the value asked for (a number, or an input's text). */
    readonly value: number | string | undefined;
    readonly target: UiNode | null;
    readonly currentTarget: UiNode | null;
  }

  export class InputEvent extends Event {
    constructor(
      type: string,
      init?: EventInit & { data?: string | null; inputType?: string },
    );
    readonly data: string | null;
    readonly inputType: string;
    readonly target: UiNode | null;
    readonly currentTarget: UiNode | null;
  }
}

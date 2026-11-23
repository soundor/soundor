import { ArrowRight } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';

export interface WorkflowStep {
  readonly title: string;
  readonly body: ReactNode;
  readonly link: { readonly href: string; readonly text: string };
  /** The step's scene at `progress` (0 to 1): from writing to its result. */
  readonly view: (progress: number) => ReactNode;
}

/** How long a scene takes to play, in milliseconds. */
const duration = 5500;

/**
 * Plays a scene once, from the moment its element is first half in view:
 * the progress goes from 0 to 1 over time, not with the scroll, and stays
 * at 1 after. With reduced motion the scene is shown finished.
 */
function usePlayOnView() {
  const element = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const target = element.current;
    if (!target) return;
    let frame = 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
          setProgress(1);
          return;
        }
        const start = performance.now();
        const tick = (now: number) => {
          const done = Math.min(1, (now - start) / duration);
          setProgress(done);
          if (done < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      },
      { threshold: 0.5 },
    );
    observer.observe(target);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  return { element, progress };
}

function Step({
  step,
  index,
}: {
  readonly step: WorkflowStep;
  readonly index: number;
}) {
  const { element, progress } = usePlayOnView();
  // The text and the scene swap sides from one step to the next.
  const flipped = index % 2 === 1;
  return (
    <li className="grid items-center gap-6 py-10 lg:grid-cols-2 lg:gap-14 lg:py-14">
      <div
        className={`lg:max-w-md ${flipped ? 'lg:order-2 lg:justify-self-end' : ''}`}
      >
        <span
          aria-hidden
          className="flex size-8 items-center justify-center rounded-full bg-fd-primary text-sm text-fd-primary-foreground"
        >
          {index + 1}
        </span>
        <h3 className="mt-4 text-2xl font-semibold tracking-tight">
          {step.title}
        </h3>
        <div className="mt-3 space-y-3 text-fd-muted-foreground [&_code]:rounded [&_code]:border [&_code]:bg-fd-muted [&_code]:px-1 [&_code]:text-[0.85em] [&_code]:text-fd-foreground">
          {step.body}
        </div>
        <a
          href={step.link.href}
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-fd-primary hover:underline"
        >
          {step.link.text}
          <ArrowRight aria-hidden className="size-3.5" />
        </a>
      </div>
      <div
        ref={element}
        className={`flex min-w-0 flex-col gap-5 rounded-2xl border bg-fd-card p-5 shadow-xl shadow-black/10 dark:shadow-black/40 [&_figure]:my-0 lg:w-[calc(100%+6rem)] ${flipped ? 'lg:order-1 lg:-ml-24' : 'lg:-mr-24'}`}
      >
        {step.view(progress)}
      </div>
    </li>
  );
}

/**
 * The home page's walk through a project: the steps zig-zag down the page,
 * each with its scene beside it, on alternate sides. A scene plays once, as
 * it first comes into view, from writing the code to its result.
 */
export function Workflow({
  steps,
}: {
  readonly steps: readonly WorkflowStep[];
}) {
  return (
    <ol>
      {steps.map((step, index) => (
        <Step key={step.title} step={step} index={index} />
      ))}
    </ol>
  );
}

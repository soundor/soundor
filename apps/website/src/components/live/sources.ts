/** The code a live preview runs, as the site's `*.json` files have it. */
export interface Sources {
  /** The file the UI starts from. */
  readonly entry: string;
  /** The files, by path from the example's root (`src/App.tsx`). */
  readonly files: Readonly<Record<string, string>>;
  /** The files the editor shows; every one when absent. */
  readonly editable?: readonly string[];
  /** The images the files import: asset ids by path (`src/assets/cover.png`). */
  readonly assets?: Readonly<Record<string, string>>;
}

export async function loadJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status}`);
  return (await response.json()) as T;
}

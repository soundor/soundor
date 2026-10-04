import { ASSET_PATH, isAssetId } from './protocol';

/**
 * The URL of a plugin UI asset, by the id the bundle names it with
 * (`import logo from './logo.png'`). Relative to the page, so a build works
 * wherever it is hosted.
 */
export function assetUrl(id: string): string {
  if (!isAssetId(id)) throw new TypeError(`Not a Soundor asset: '${id}'`);
  return new URL(`${ASSET_PATH}/${id}`, document.baseURI).href;
}

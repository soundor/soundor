import type { HostEnvironment } from './host';

/** Best-effort browser OS identification. The native binary architecture is not available. */
export function browserEnvironment(
  runtimeVersion: string,
  agent: Pick<Navigator, 'userAgent' | 'maxTouchPoints'>,
): Readonly<HostEnvironment> {
  const ua = agent.userAgent;
  let platform: HostEnvironment['platform'] = 'unknown';
  if (
    /iPad|iPhone|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && agent.maxTouchPoints > 1)
  )
    platform = 'ios';
  else if (/Android/.test(ua)) platform = 'android';
  else if (/Windows/.test(ua)) platform = 'windows';
  else if (/Macintosh|Mac OS X/.test(ua)) platform = 'macos';
  else if (/Linux/.test(ua)) platform = 'linux';
  return Object.freeze({
    runtime: 'web',
    runtimeVersion,
    platform,
    arch: 'unknown',
    format: 'web',
  });
}

// Is a release tag newer than the running version? "v0.2.0" vs "0.1.0". Pure.
// The About section asks GitHub once per session, only when settings are opened (PRD §3.2.6).

const parse = (v: string) => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(v.trim());
  return m ? { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? '' } : null;
};

export function isNewer(tag: string, current: string): boolean {
  const a = parse(tag), b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a.nums[i]! !== b.nums[i]!) return a.nums[i]! > b.nums[i]!;
  // Same numbers: a release beats a pre-release of it; two pre-releases compare as text.
  if (a.pre === b.pre) return false;
  if (!a.pre) return true;
  if (!b.pre) return false;
  return a.pre > b.pre;
}

export const LATEST_RELEASE_URL = 'https://api.github.com/repos/Zaious/basesmall/releases/latest';

/** The newest published release, if it is newer than `current`. Never throws. */
export async function newerRelease(current: string, fetchFn: typeof fetch = fetch): Promise<{ tag: string; url: string } | null> {
  try {
    const res = await fetchFn(LATEST_RELEASE_URL, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) return null;
    const j = (await res.json()) as { tag_name?: string; html_url?: string; draft?: boolean; prerelease?: boolean };
    if (!j.tag_name || !j.html_url || j.draft || j.prerelease) return null;
    return isNewer(j.tag_name, current) ? { tag: j.tag_name, url: j.html_url } : null;
  } catch {
    return null;
  }
}

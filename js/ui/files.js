// Getting a file OFF the device: share sheet where available (best on iPhone/Android), download otherwise.
export async function deliverFile(name, text, mime = 'application/json') {
  const file = new File([text], name, { type: mime });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return 'shared';
    }
  } catch (e) {
    if (e?.name === 'AbortError') return 'cancelled';
    // any other share error: fall through to download
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return 'downloaded';
}

export function readTextFile(file) {
  return new Promise((resolve, reject) => {
    if (file.size > 25 * 1024 * 1024) return reject(new Error('File is too big (over 25 MB).'));
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read the file.'));
    r.readAsText(file);
  });
}

const HOOK = /^https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/;
export const isDiscordWebhook = (u) => HOOK.test(String(u || '').trim());

/** Optional private backup channel. Never blocks closing the day. */
export async function postToDiscord(url, name, text, note = '') {
  if (!isDiscordWebhook(url)) return false;
  try {
    const fd = new FormData();
    fd.append('content', note.slice(0, 1800));
    fd.append('files[0]', new File([text], name, { type: 'application/json' }));
    const res = await fetch(url.trim(), { method: 'POST', body: fd });
    return res.ok;
  } catch { return false; }
}

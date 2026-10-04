// The two things on the site that need a script. Without it the page still works: the download
// buttons open the release page on GitHub, and the waitlist form posts as a plain form.
(() => {
  const zh = document.documentElement.lang === 'zh-Hant';

  // ---------- download: the latest release's files, the visitor's system first ----------
  const ua = navigator.userAgent;
  const phone = /iPhone|iPad|Android/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const os = phone ? '' : /Windows/.test(ua) ? 'windows' : /Mac OS X|Macintosh/.test(ua) ? 'mac' : /Linux|X11/.test(ua) ? 'linux' : '';
  if (os) {
    for (const p of document.querySelectorAll('.platform')) {
      const mine = p.dataset.os === os;
      p.classList.toggle('mine', mine);
      p.querySelector('.btn')?.classList.toggle('primary', mine);
    }
  }
  if (phone) document.querySelector('.on-phone')?.removeAttribute('hidden');

  const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
  fetch('https://api.github.com/repos/Zaious/basesmall/releases/latest', { headers: { accept: 'application/vnd.github+json' } })
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((rel) => {
      for (const a of document.querySelectorAll('a[data-file]')) {
        const f = (rel.assets ?? []).find((x) => x.name.endsWith(a.dataset.file));
        if (!f) continue;
        a.href = f.browser_download_url;
        const size = a.querySelector('.size');
        if (size) size.textContent = mb(f.size);
      }
      const ver = document.querySelector('.ver b');
      if (ver && rel.tag_name) { ver.textContent = rel.tag_name; ver.parentElement.hidden = false; }
    })
    .catch(() => { /* the buttons keep pointing at the release page */ });

  // ---------- the mobile waitlist ----------
  const form = document.getElementById('waitlist-form');
  const msg = document.querySelector('#waitlist .msg');
  if (!form || !msg) return;
  const SAY = zh
    ? { joined: '收到了。有手機版的消息時，會寄一封信給你。', left: '這個 Email 已經刪除。', invalid: 'Email 看起來不太對，再檢查一下。', busy: '同時登記的人太多，請過一分鐘再試。', error: '沒有送出，請稍後再試。' }
    : { joined: "Got it. You'll get one email when there is news about a mobile version.", left: 'That address has been removed.', invalid: "That email doesn't look right.", busy: 'Too many sign-ups at once; try again in a minute.', error: "Couldn't send it; try again later." };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    data.action = e.submitter?.value === 'leave' ? 'leave' : 'join';
    for (const b of form.querySelectorAll('button')) b.disabled = true;
    let result = 'error';
    try {
      // getAttribute: the buttons are named "action", which hides the form's own .action.
      const r = await fetch(form.getAttribute('action'), { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(data) });
      result = (await r.json()).result ?? 'error';
    } catch { /* stays 'error' */ }
    msg.textContent = SAY[result] ?? SAY.error;
    msg.dataset.result = result;
    for (const b of form.querySelectorAll('button')) b.disabled = false;
    if (result === 'joined' || result === 'left') form.reset();
  });
})();

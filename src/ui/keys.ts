// How a hotkey reads on this system. Settings keep Tauri's accelerator text ("CmdOrCtrl+Alt+Shift+B"),
// which is right on every platform but reads as nothing on a Mac. Pure.

const MAC_ORDER = ['⌃', '⌥', '⇧', '⌘'];

export function keyLabel(accel: string, mac: boolean): string {
  const parts = accel.split('+').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return '';
  const mods = new Set<string>();
  let key = '';
  for (const p of parts) {
    const k = p.toLowerCase();
    if (k === 'cmdorctrl' || k === 'commandorcontrol') mods.add(mac ? '⌘' : 'Ctrl');
    else if (k === 'cmd' || k === 'command' || k === 'super' || k === 'meta') mods.add(mac ? '⌘' : 'Win');
    else if (k === 'ctrl' || k === 'control') mods.add(mac ? '⌃' : 'Ctrl');
    else if (k === 'alt' || k === 'option') mods.add(mac ? '⌥' : 'Alt');
    else if (k === 'shift') mods.add(mac ? '⇧' : 'Shift');
    else key = /^key[a-z]$/i.test(p) ? p.slice(3).toUpperCase() : /^digit\d$/i.test(p) ? p.slice(5) : p.length === 1 ? p.toUpperCase() : p;
  }
  if (mac) return MAC_ORDER.filter((m) => mods.has(m)).join('') + key;
  return [...['Ctrl', 'Win', 'Alt', 'Shift'].filter((m) => mods.has(m)), key].filter(Boolean).join('+');
}

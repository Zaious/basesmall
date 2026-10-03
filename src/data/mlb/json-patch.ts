// RFC 6902 JSON Patch, enough for MLB's feed/live/diffPatch responses
// (which use add, remove, replace and copy). Mutates the document in place.

export interface PatchOp {
  op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
  path: string;
  from?: string;
  value?: unknown;
}

export class PatchError extends Error {}

type Container = Record<string, unknown> | unknown[];

function parse(pointer: string): string[] {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) throw new PatchError(`bad pointer ${pointer}`);
  return pointer.slice(1).split('/').map((t) => t.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function parent(doc: unknown, tokens: string[]): { box: Container; key: string } {
  let box = doc as Container;
  for (const t of tokens.slice(0, -1)) {
    const next = Array.isArray(box) ? box[Number(t)] : (box as Record<string, unknown>)[t];
    if (next === null || typeof next !== 'object') throw new PatchError(`missing /${tokens.join('/')}`);
    box = next as Container;
  }
  return { box, key: tokens.at(-1)! };
}

function get(doc: unknown, pointer: string): unknown {
  let cur: unknown = doc;
  for (const t of parse(pointer)) {
    if (cur === null || typeof cur !== 'object') throw new PatchError(`missing ${pointer}`);
    cur = Array.isArray(cur) ? cur[Number(t)] : (cur as Record<string, unknown>)[t];
    if (cur === undefined) throw new PatchError(`missing ${pointer}`);
  }
  return cur;
}

function index(arr: unknown[], key: string, forInsert: boolean): number {
  if (forInsert && key === '-') return arr.length;
  const i = Number(key);
  if (!Number.isInteger(i) || i < 0 || i > arr.length || (!forInsert && i === arr.length)) throw new PatchError(`bad index ${key}`);
  return i;
}

function add(doc: unknown, pointer: string, value: unknown): unknown {
  const tokens = parse(pointer);
  if (tokens.length === 0) return value;
  const { box, key } = parent(doc, tokens);
  if (Array.isArray(box)) box.splice(index(box, key, true), 0, value);
  else box[key] = value;
  return doc;
}

function remove(doc: unknown, pointer: string): unknown {
  const tokens = parse(pointer);
  const { box, key } = parent(doc, tokens);
  if (Array.isArray(box)) box.splice(index(box, key, false), 1);
  else {
    if (!(key in box)) throw new PatchError(`missing ${pointer}`);
    delete box[key];
  }
  return doc;
}

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

/** Apply operations in order. Returns the (possibly replaced) root. Throws PatchError when a
 *  path does not exist; the caller should then fetch the whole document again. */
export function applyPatch<T>(doc: T, ops: readonly PatchOp[]): T {
  let root: unknown = doc;
  for (const op of ops) {
    switch (op.op) {
      case 'add': root = add(root, op.path, clone(op.value)); break;
      case 'remove': root = remove(root, op.path); break;
      case 'replace': get(root, op.path); root = op.path === '' ? clone(op.value) : add(remove(root, op.path), op.path, clone(op.value)); break;
      case 'copy': root = add(root, op.path, clone(get(root, op.from ?? ''))); break;
      case 'move': {
        const v = get(root, op.from ?? '');
        root = add(remove(root, op.from ?? ''), op.path, v);
        break;
      }
      case 'test':
        if (JSON.stringify(get(root, op.path)) !== JSON.stringify(op.value)) throw new PatchError(`test failed at ${op.path}`);
        break;
      default: throw new PatchError(`unknown op ${(op as PatchOp).op}`);
    }
  }
  return root as T;
}

// Where the words are on each page of a PDF — read-only, no library. For placing blocks
// next to a form's own printed labels ("Signature of Seller") when the agent has no
// template (autoplace.js). Nothing here changes a PDF (PLAN rule 4).
//
// Just enough PDF for the forms WEBForms produces (2026-10-29): objects found by scanning
// (incremental saves: the last copy wins) plus compressed object streams; Flate streams;
// the Standard security handler with an EMPTY user password — WEBForms locks its PDFs
// against editing (RC4, R3) but anyone may open them — and AES-128; simple and Type0 fonts
// with ToUnicode maps; Form XObjects. Anything else gives fewer words, never an error: the
// caller treats "found nothing" as "place nothing".

const latin1 = (u8) => new TextDecoder("latin1").decode(u8);

// ---------------------------------------------------------------- lexer

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]);

class Lexer {
  constructor(u8, pos = 0) { this.b = u8; this.p = pos; }
  skip() {
    const b = this.b;
    for (;;) {
      while (this.p < b.length && WS.has(b[this.p])) this.p++;
      if (b[this.p] !== 37) return; // %
      while (this.p < b.length && b[this.p] !== 10 && b[this.p] !== 13) this.p++;
    }
  }
  // One token: {t: "num"|"name"|"str"|"kw"|"[" … , v}
  next() {
    this.skip();
    const b = this.b;
    if (this.p >= b.length) return null;
    const c = b[this.p];
    if (c === 47) { // /Name
      let s = "";
      this.p++;
      while (this.p < b.length && !WS.has(b[this.p]) && !DELIM.has(b[this.p])) {
        if (b[this.p] === 35 && this.p + 2 < b.length) { // #xx
          s += String.fromCharCode(parseInt(latin1(b.subarray(this.p + 1, this.p + 3)), 16));
          this.p += 3;
        } else s += String.fromCharCode(b[this.p++]);
      }
      return { t: "name", v: s };
    }
    if (c === 40) return { t: "str", v: this.literal() };
    if (c === 60) {
      if (b[this.p + 1] === 60) { this.p += 2; return { t: "<<" }; }
      return { t: "str", v: this.hex() };
    }
    if (c === 62 && b[this.p + 1] === 62) { this.p += 2; return { t: ">>" }; }
    if (c === 91 || c === 93 || c === 123 || c === 125) { this.p++; return { t: String.fromCharCode(c) }; }
    let s = "";
    while (this.p < b.length && !WS.has(b[this.p]) && !DELIM.has(b[this.p])) s += String.fromCharCode(b[this.p++]);
    if (!s) { this.p++; return this.next(); } // a stray ")" or ">"
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return { t: "num", v: Number(s) };
    return { t: "kw", v: s };
  }
  literal() {
    const b = this.b, out = [];
    let depth = 0;
    this.p++;
    while (this.p < b.length) {
      const c = b[this.p++];
      if (c === 92) { // backslash
        const d = b[this.p++];
        const esc = { 110: 10, 114: 13, 116: 9, 98: 8, 102: 12 }[d];
        if (esc !== undefined) out.push(esc);
        else if (d >= 48 && d <= 55) {
          let o = d - 48;
          for (let k = 0; k < 2 && b[this.p] >= 48 && b[this.p] <= 55; k++) o = o * 8 + (b[this.p++] - 48);
          out.push(o & 255);
        } else if (d === 13) { if (b[this.p] === 10) this.p++; } else if (d !== 10) out.push(d);
      } else if (c === 40) { depth++; out.push(c); } else if (c === 41) {
        if (depth === 0) break;
        depth--; out.push(c);
      } else out.push(c);
    }
    return Uint8Array.from(out);
  }
  hex() {
    const b = this.b;
    let s = "";
    this.p++;
    while (this.p < b.length && b[this.p] !== 62) {
      if (!WS.has(b[this.p])) s += String.fromCharCode(b[this.p]);
      this.p++;
    }
    this.p++;
    if (s.length % 2) s += "0";
    const out = new Uint8Array(s.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(2 * i, 2 * i + 2), 16) || 0;
    return out;
  }
}

// Values: numbers, booleans, null, {name}, Uint8Array strings, arrays, Map dicts, {ref}.
function parseValue(lx, tok = lx.next()) {
  if (!tok) return null;
  switch (tok.t) {
    case "num": {
      // "12 0 R" is a reference; peek two tokens ahead.
      const save = lx.p;
      const a = lx.next();
      if (a?.t === "num") {
        const r = lx.next();
        if (r?.t === "kw" && r.v === "R") return { ref: tok.v, gen: a.v };
      }
      lx.p = save;
      return tok.v;
    }
    case "name": return { name: tok.v };
    case "str": return tok.v;
    case "[": {
      const arr = [];
      for (let t = lx.next(); t && t.t !== "]"; t = lx.next()) arr.push(parseValue(lx, t));
      return arr;
    }
    case "<<": {
      const d = new Map();
      for (let t = lx.next(); t && t.t !== ">>"; t = lx.next()) {
        if (t.t === "name") d.set(t.v, parseValue(lx));
      }
      return d;
    }
    case "kw": return tok.v === "true" ? true : tok.v === "false" ? false : null;
    default: return null;
  }
}

const isName = (v, n) => v && typeof v === "object" && v.name === n;
const nameOf = (v) => (v && typeof v === "object" && "name" in v ? v.name : null);

// ---------------------------------------------------------------- crypto (open-only)

// MD5 (RFC 1321): the Standard security handler's key derivation. WebCrypto has no MD5.
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
export function md5(bytes) {
  const n = bytes.length;
  const len = ((n + 8) >> 6 << 6) + 64;
  const m = new Uint8Array(len);
  m.set(bytes);
  m[n] = 0x80;
  const dv = new DataView(m.buffer);
  dv.setUint32(len - 8, (n * 8) >>> 0, true);
  dv.setUint32(len - 4, Math.floor(n / 2 ** 29), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let off = 0; off < len; off += 64) {
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16) { f = (b & c) | (~b & d); g = i; } else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; } else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; } else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const tmp = d;
      d = c; c = b;
      const x = (a + f + K[i] + dv.getUint32(off + g * 4, true)) >>> 0;
      const s = S[(i >> 4) * 4 + (i % 4)];
      b = (b + ((x << s) | (x >>> (32 - s)))) >>> 0;
      a = tmp;
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
  }
  const out = new Uint8Array(16);
  const o = new DataView(out.buffer);
  [a0, b0, c0, d0].forEach((v, i) => o.setUint32(i * 4, v, true));
  return out;
}

export function rc4(key, data) {
  const s = new Uint8Array(256).map((_, i) => i);
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = new Uint8Array(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 255; j = (j + s[i]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
    out[k] = data[k] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
}

const PAD = Uint8Array.from([0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a]);

const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

/** The file key for the empty user password (Algorithm 2), or null when this handler isn't
 *  one we open (a real password, AES-256). */
function fileKey(enc, id0) {
  const v = enc.get("V") ?? 0, r = enc.get("R") ?? 2;
  if (nameOf(enc.get("Filter")) !== "Standard" || v > 4 || r > 4) return null;
  const n = r === 2 ? 5 : (enc.get("Length") ?? 40) / 8;
  const p = new Uint8Array(4);
  new DataView(p.buffer).setInt32(0, enc.get("P") ?? 0, true);
  const o = enc.get("O") instanceof Uint8Array ? enc.get("O").subarray(0, 32) : new Uint8Array(32);
  const parts = [PAD, o, p, id0 || new Uint8Array(0)];
  if (r >= 4 && enc.get("EncryptMetadata") === false) parts.push(Uint8Array.from([255, 255, 255, 255]));
  let key = md5(concat(...parts)).subarray(0, n);
  if (r >= 3) for (let i = 0; i < 50; i++) key = md5(key).subarray(0, n);
  return Uint8Array.from(key);
}

// ---------------------------------------------------------------- the document

async function inflate(data) {
  const run = async (fmt, bytes) => {
    const ds = new DecompressionStream(fmt);
    const w = ds.writable.getWriter();
    w.write(bytes).catch(() => {});
    w.close().catch(() => {});
    const chunks = [];
    const r = ds.readable.getReader();
    try {
      for (;;) { const { done, value } = await r.read(); if (done) break; chunks.push(value); }
    } catch (e) {
      // Some writers leave junk after the end of the data; what came out before it is good.
      if (!chunks.length) throw e;
    }
    return concat(...chunks);
  };
  try { return await run("deflate", data); } catch { return run("deflate-raw", data.subarray(2)); }
}

// PNG predictors (DecodeParms /Predictor >= 10), as object streams sometimes use.
function unpredict(data, parms) {
  const pred = parms?.get?.("Predictor") ?? 1;
  if (pred < 10) return data;
  const cols = parms.get("Columns") ?? 1, colors = parms.get("Colors") ?? 1, bpc = parms.get("BitsPerComponent") ?? 8;
  const bpp = Math.max(1, (colors * bpc) >> 3), row = (cols * colors * bpc + 7) >> 3;
  const out = [];
  let prev = new Uint8Array(row);
  for (let i = 0; i + row < data.length + 1; i += row + 1) {
    const type = data[i], cur = Uint8Array.from(data.subarray(i + 1, i + 1 + row));
    for (let x = 0; x < cur.length; x++) {
      const left = x >= bpp ? cur[x - bpp] : 0, up = prev[x], ul = x >= bpp ? prev[x - bpp] : 0;
      if (type === 1) cur[x] = (cur[x] + left) & 255;
      else if (type === 2) cur[x] = (cur[x] + up) & 255;
      else if (type === 3) cur[x] = (cur[x] + ((left + up) >> 1)) & 255;
      else if (type === 4) {
        const pa = Math.abs(up - ul), pb = Math.abs(left - ul), pc = Math.abs(left + up - 2 * ul);
        cur[x] = (cur[x] + (pa <= pb && pa <= pc ? left : pb <= pc ? up : ul)) & 255;
      }
    }
    out.push(cur);
    prev = cur;
  }
  return concat(...out);
}

class Doc {
  constructor(u8) {
    this.b = u8;
    this.offsets = new Map(); // obj number → byte offset (last copy wins)
    this.cache = new Map();
    this.inStreams = new Map(); // obj number → value, from object streams
    this.key = null;
    this.aes = false;
    const text = latin1(u8);
    for (const m of text.matchAll(/(?<![0-9])(\d+)\s+(\d+)\s+obj\b/g)) this.offsets.set(Number(m[1]), m.index);
    this.text = text;
  }
  // The object at an offset: {value, stream?: Uint8Array raw bytes}
  parseAt(num, off) {
    const lx = new Lexer(this.b, off);
    lx.next(); lx.next(); lx.next(); // "n g obj"
    const value = parseValue(lx);
    const save = lx.p;
    const kw = lx.next();
    if (value instanceof Map && kw?.t === "kw" && kw.v === "stream") {
      let p = lx.p;
      if (this.b[p] === 13) p++;
      if (this.b[p] === 10) p++;
      let len = value.get("Length");
      if (len && typeof len === "object" && "ref" in len) len = this.getSync(len);
      let end = typeof len === "number" ? p + len : -1;
      if (end < 0 || end > this.b.length || !/^\s*endstream/.test(latin1(this.b.subarray(end, end + 20)))) {
        end = this.text.indexOf("endstream", p);
        if (end < 0) end = this.b.length;
        while (end > p && (this.b[end - 1] === 10 || this.b[end - 1] === 13)) end--;
      }
      return { value, raw: this.b.subarray(p, end), num };
    }
    lx.p = save;
    return { value };
  }
  getSync(ref) { // direct objects only (for /Length and the like)
    if (!ref || typeof ref !== "object" || !("ref" in ref)) return ref;
    if (this.inStreams.has(ref.ref)) return this.inStreams.get(ref.ref);
    const off = this.offsets.get(ref.ref);
    return off === undefined ? null : this.parseAt(ref.ref, off).value;
  }
  async init() {
    // The trailer: the last "trailer" dict, or the last cross-reference stream's dict.
    let trailer = null;
    for (const m of this.text.matchAll(/trailer\s*<</g)) {
      const lx = new Lexer(this.b, m.index + 7);
      const t = parseValue(lx);
      if (t instanceof Map) trailer = trailer ? new Map([...t, ...[...trailer].filter(([k]) => !t.has(k))]) : t;
    }
    for (const [num, off] of this.offsets) {
      if (!/\/Type\s*\/XRef/.test(this.text.slice(off, off + 600))) continue;
      const v = this.parseAt(num, off).value;
      if (v instanceof Map && v.has("Root")) trailer = trailer && trailer.has("Root") && !v.has("Encrypt") ? trailer : v;
    }
    this.trailer = trailer || new Map();
    const enc = this.getSync(this.trailer.get("Encrypt"));
    if (enc instanceof Map) {
      const id = this.trailer.get("ID");
      this.key = fileKey(enc, Array.isArray(id) && id[0] instanceof Uint8Array ? id[0] : null);
      if (!this.key) throw new Error("this PDF has a password");
      const cf = enc.get("CF")?.get?.(nameOf(enc.get("StmF")) || "StdCF");
      this.aes = nameOf(cf?.get?.("CFM")) === "AESV2";
      this.encryptNum = this.trailer.get("Encrypt")?.ref;
    }
    // Compressed object streams: fill in every object they hold.
    for (const [num, off] of this.offsets) {
      if (!/\/Type\s*\/ObjStm/.test(this.text.slice(off, off + 600))) continue;
      try {
        const o = this.parseAt(num, off);
        const data = await this.streamData(o);
        const n = o.value.get("N") ?? 0, first = o.value.get("First") ?? 0;
        const lx = new Lexer(data);
        const pairs = [];
        for (let i = 0; i < n; i++) pairs.push([lx.next()?.v, lx.next()?.v]);
        for (const [objNum, rel] of pairs) {
          if (this.offsets.has(objNum) && this.offsets.get(objNum) > off) continue; // a later direct copy wins
          const vlx = new Lexer(data, first + rel);
          this.inStreams.set(objNum, parseValue(vlx));
        }
      } catch { /* an unreadable object stream: those objects stay missing */ }
    }
    for (const n of this.inStreams.keys()) this.offsets.delete(n);
  }
  get(v) {
    if (!v || typeof v !== "object" || !("ref" in v)) return v;
    const n = v.ref;
    if (this.inStreams.has(n)) return this.inStreams.get(n);
    if (!this.cache.has(n)) {
      const off = this.offsets.get(n);
      this.cache.set(n, off === undefined ? { value: null } : this.parseAt(n, off));
    }
    return this.cache.get(n).value;
  }
  getStreamObj(v) {
    if (!v || typeof v !== "object" || !("ref" in v)) return null;
    this.get(v);
    const o = this.cache.get(v.ref);
    return o?.raw ? o : null;
  }
  async streamData(o) {
    let data = o.raw;
    if (this.key && o.num !== this.encryptNum && !isName(o.value.get("Type"), "XRef")) {
      const k = md5(concat(this.key, Uint8Array.from([o.num & 255, (o.num >> 8) & 255, (o.num >> 16) & 255, 0, 0]),
        this.aes ? Uint8Array.from([0x73, 0x41, 0x6c, 0x54]) : new Uint8Array(0))).subarray(0, Math.min(this.key.length + 5, 16));
      if (this.aes) {
        const ck = await crypto.subtle.importKey("raw", k, "AES-CBC", false, ["decrypt"]);
        data = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-CBC", iv: data.subarray(0, 16) }, ck, data.subarray(16)));
      } else data = rc4(k, data);
    }
    const f = this.get(o.value.get("Filter"));
    const filters = (Array.isArray(f) ? f : f ? [f] : []).map(nameOf);
    const parms = this.get(o.value.get("DecodeParms"));
    for (const [i, name] of filters.entries()) {
      if (name === "FlateDecode" || name === "Fl") {
        data = unpredict(await inflate(data), this.get(Array.isArray(parms) ? parms[i] : parms));
      } else if (name === "ASCIIHexDecode" || name === "AHx") {
        data = new Lexer(concat(Uint8Array.of(60), data, Uint8Array.of(62))).hex();
      } else throw new Error(`stream filter ${name} not read`);
    }
    return data;
  }
  async stream(ref) {
    const o = this.getStreamObj(ref);
    return o ? this.streamData(o) : null;
  }
}

// ---------------------------------------------------------------- fonts

// The glyph names a simple font's /Differences uses for the characters labels are made of.
const GLYPHS = {
  space: " ", underscore: "_", period: ".", comma: ",", colon: ":", semicolon: ";", hyphen: "-",
  quoteright: "'", quotesingle: "'", quoteleft: "'", quotedbl: '"', quotedblleft: '"', quotedblright: '"',
  parenleft: "(", parenright: ")", slash: "/", ampersand: "&", numbersign: "#", percent: "%", dollar: "$",
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9",
  endash: "–", emdash: "—", bullet: "•", registered: "®", copyright: "©", question: "?", exclam: "!",
};
const glyphChar = (g) => {
  if (/^[A-Za-z]$/.test(g)) return g;
  if (GLYPHS[g]) return GLYPHS[g];
  const u = /^uni([0-9A-F]{4})$/i.exec(g) || /^u([0-9A-F]{4,6})$/i.exec(g);
  if (u) return String.fromCodePoint(parseInt(u[1], 16));
  const base = /^([A-Za-z])(\.|_)/.exec(g); // "a.sc", "f_i" → first letter, near enough
  return base ? base[1] : "";
};
const MAC_QUOTES = { 195: '"', 196: '"', 197: "'", 198: "'" };
// WinAnsi's differences from Latin-1 that matter in form text.
const WINANSI = { 0x91: "'", 0x92: "'", 0x93: '"', 0x94: '"', 0x95: "•", 0x96: "–", 0x97: "—", 0xae: "®" };

function parseCMap(bytes) {
  const s = latin1(bytes);
  const map = new Map();
  let bytesPerCode = 1;
  const hex = (h) => parseInt(h, 16);
  const utf16 = (h) => {
    let out = "";
    for (let i = 0; i + 4 <= h.length; i += 4) out += String.fromCharCode(parseInt(h.slice(i, i + 4), 16));
    return out;
  };
  for (const m of s.matchAll(/begincodespacerange([\s\S]*?)endcodespacerange/g)) {
    const first = /<([0-9a-fA-F]+)>/.exec(m[1]);
    if (first) bytesPerCode = first[1].length / 2;
  }
  for (const m of s.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const p of m[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) map.set(hex(p[1]), utf16(p[2]));
  }
  for (const m of s.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const p of m[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]*>|\[[^\]]*\])/g)) {
      const lo = hex(p[1]), hi = hex(p[2]);
      if (hi - lo > 0xffff) continue;
      if (p[3].startsWith("[")) {
        [...p[3].matchAll(/<([0-9a-fA-F]*)>/g)].forEach((d, i) => map.set(lo + i, utf16(d[1])));
      } else {
        const dst = p[3].slice(1, -1);
        const head = dst.slice(0, -4), last = parseInt(dst.slice(-4) || "0", 16);
        for (let c = lo; c <= hi; c++) map.set(c, utf16(head) + String.fromCharCode(last + c - lo));
      }
    }
  }
  return { map, bytesPerCode };
}

async function loadFont(doc, ref) {
  const f = doc.get(ref);
  if (!(f instanceof Map)) return null;
  const type0 = isName(f.get("Subtype"), "Type0");
  const font = { bytes: 1, width: () => 500, text: (c) => String.fromCharCode(c) };
  const tu = await doc.stream(f.get("ToUnicode")).catch(() => null);
  const cmap = tu ? parseCMap(tu) : null;
  if (type0) {
    font.bytes = 2;
    const d = doc.get(doc.get(f.get("DescendantFonts"))?.[0]);
    const dw = doc.get(d?.get?.("DW")) ?? 1000;
    const widths = new Map();
    const w = doc.get(d?.get?.("W")) || [];
    for (let i = 0; i < w.length;) {
      const a = doc.get(w[i]), b = doc.get(w[i + 1]);
      if (Array.isArray(b)) { b.forEach((x, k) => widths.set(a + k, doc.get(x))); i += 2; } else { for (let c = a; c <= b; c++) widths.set(c, doc.get(w[i + 2])); i += 3; }
    }
    font.width = (c) => widths.get(c) ?? dw;
    // No ToUnicode map, and the embedded font kept no cmap either (RECA's Consumer
    // Relationships Guide from WEBForms, 2026-10-29): the codes are glyph numbers. Fonts like
    // Arial and Verdana keep the Macintosh standard glyph order, where glyphs 3–97 are the
    // printable ASCII characters in order and 197/198 the curly quotes — enough for labels.
    // A font in some other order reads as nonsense, which matches no label.
    font.text = (c) => cmap?.map.get(c)
      ?? (cmap ? "" : c >= 3 && c <= 97 ? String.fromCharCode(c + 29) : MAC_QUOTES[c] ?? "");
    return font;
  }
  const first = doc.get(f.get("FirstChar")) ?? 0;
  const widths = (doc.get(f.get("Widths")) || []).map((x) => doc.get(x));
  const desc = doc.get(f.get("FontDescriptor"));
  const missing = doc.get(desc?.get?.("MissingWidth")) || (/Courier/.test(nameOf(f.get("BaseFont")) || "") ? 600 : 500);
  font.width = (c) => widths[c - first] || missing;
  const enc = doc.get(f.get("Encoding"));
  const diffs = new Map();
  if (enc instanceof Map) {
    let code = 0;
    for (const x of doc.get(enc.get("Differences")) || []) {
      if (typeof x === "number") code = x; else diffs.set(code++, glyphChar(nameOf(x) || ""));
    }
  }
  font.text = (c) => cmap?.map.get(c) ?? diffs.get(c) ?? WINANSI[c] ?? (c >= 32 ? String.fromCharCode(c) : "");
  return font;
}

// ---------------------------------------------------------------- content streams

const mul = (a, b) => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** Past an inline image: its dictionary up to ID, one whitespace byte, then raw bytes up to
 *  an EI with whitespace before it and whitespace (or the end) after — the spec gives no
 *  length for filtered data, so this is how readers find the end. */
function skipInlineImage(lx) {
  for (let t = lx.next(); t && !(t.t === "kw" && t.v === "ID"); t = lx.next()) { /* the image's dictionary */ }
  const b = lx.b;
  let p = lx.p + 1;
  for (; p + 1 < b.length; p++) {
    if (b[p] === 69 && b[p + 1] === 73 && WS.has(b[p - 1]) && (p + 2 >= b.length || WS.has(b[p + 2]))) { p += 2; break; }
  }
  lx.p = Math.min(p, b.length);
}

async function runContent(doc, data, resources, ctm0, out, depth = 0) {
  if (depth > 8 || !data) return;
  const fonts = doc.get(resources?.get?.("Font"));
  const xobjects = doc.get(resources?.get?.("XObject"));
  const fontCache = out.fontCache;
  const lx = new Lexer(data);
  const ops = [];
  let gs = { ctm: ctm0 };
  const stack = [];
  let ts = { font: null, size: 0, tc: 0, tw: 0, th: 1, tl: 0, rise: 0 };
  let tm = [1, 0, 0, 1, 0, 0], tlm = tm;
  let path = [];
  let cur = null;

  const show = (bytes) => {
    const f = ts.font;
    if (!f) return;
    let str = "", adv = 0;
    const offs = []; // where each character starts, in text space
    const start = mul([ts.size * ts.th, 0, 0, ts.size, 0, ts.rise], mul(tm, gs.ctm));
    for (let i = 0; i + f.bytes <= bytes.length; i += f.bytes) {
      const code = f.bytes === 2 ? (bytes[i] << 8) | bytes[i + 1] : bytes[i];
      const ch = f.text(code);
      for (let k = 0; k < ch.length; k++) offs.push(adv);
      str += ch;
      const w = (f.width(code) / 1000) * ts.size + ts.tc + (code === 32 && f.bytes === 1 ? ts.tw : 0);
      adv += w * ts.th;
    }
    const scale = Math.hypot(start[0], start[1]) / (ts.size * ts.th || 1);
    // Upright text only: a rotated label (a margin note) isn't a signing line.
    if (str.length && Math.abs(start[1]) < 1e-3 && start[0] > 0) {
      out.items.push({
        str, x: start[4], y: start[5], w: adv * scale,
        size: Math.hypot(start[2], start[3]), xs: offs.map((o) => start[4] + o * scale),
      });
    }
    tm = mul([1, 0, 0, 1, adv, 0], tm);
  };

  for (let tok = lx.next(); tok; tok = lx.next()) {
    if (tok.t !== "kw") { ops.push(parseValue(lx, tok)); continue; }
    // An inline image (BI … ID <bytes> EI): its bytes aren't operators. Read as if they
    // were, they derailed the rest of the page, and Saskatchewan's Agency Disclosure lost
    // its signature lines, drawn after a small logo (2026-10-29).
    if (tok.v === "BI") { skipInlineImage(lx); ops.length = 0; continue; }
    const op = tok.v, a = ops;
    switch (op) {
      case "q": stack.push(gs); gs = { ...gs }; break;
      case "Q": gs = stack.pop() || gs; break;
      case "cm": if (a.length >= 6) gs = { ...gs, ctm: mul(a.slice(-6), gs.ctm) }; break;
      case "BT": tm = tlm = [1, 0, 0, 1, 0, 0]; break;
      case "Tf": {
        const key = nameOf(a[a.length - 2]);
        ts.size = a[a.length - 1];
        const ref = fonts?.get?.(key);
        const id = ref && typeof ref === "object" && "ref" in ref ? `r${ref.ref}` : `${depth}:${key}`;
        if (!fontCache.has(id)) fontCache.set(id, await loadFont(doc, ref).catch(() => null));
        ts.font = fontCache.get(id);
        break;
      }
      case "Tc": ts.tc = a[a.length - 1]; break;
      case "Tw": ts.tw = a[a.length - 1]; break;
      case "Tz": ts.th = a[a.length - 1] / 100; break;
      case "TL": ts.tl = a[a.length - 1]; break;
      case "Ts": ts.rise = a[a.length - 1]; break;
      case "Td": tm = tlm = mul([1, 0, 0, 1, a[a.length - 2], a[a.length - 1]], tlm); break;
      case "TD": ts.tl = -a[a.length - 1]; tm = tlm = mul([1, 0, 0, 1, a[a.length - 2], a[a.length - 1]], tlm); break;
      case "Tm": tm = tlm = a.slice(-6); break;
      case "T*": tm = tlm = mul([1, 0, 0, 1, 0, -ts.tl], tlm); break;
      case "Tj": show(a[a.length - 1] || new Uint8Array(0)); break;
      case "'": tm = tlm = mul([1, 0, 0, 1, 0, -ts.tl], tlm); show(a[a.length - 1] || new Uint8Array(0)); break;
      case '"': ts.tw = a[0]; ts.tc = a[1]; tm = tlm = mul([1, 0, 0, 1, 0, -ts.tl], tlm); show(a[2] || new Uint8Array(0)); break;
      case "TJ": {
        for (const part of a[a.length - 1] || []) {
          if (part instanceof Uint8Array) show(part);
          else if (typeof part === "number") {
            // A kern gap moves the next run along; each run is its own item, so a wide gap
            // reads as a space when lines are put together (autoplace.js).
            tm = mul([1, 0, 0, 1, (-part / 1000) * ts.size * ts.th, 0], tm);
          }
        }
        break;
      }
      case "m": cur = apply(gs.ctm, a[a.length - 2], a[a.length - 1]); break;
      case "l": {
        const p = apply(gs.ctm, a[a.length - 2], a[a.length - 1]);
        if (cur) path.push({ x1: cur[0], y1: cur[1], x2: p[0], y2: p[1] });
        cur = p;
        break;
      }
      case "re": {
        const [x, y, w, h] = a.slice(-4);
        const p1 = apply(gs.ctm, x, y), p2 = apply(gs.ctm, x + w, y + h);
        path.push({ rect: true, x1: Math.min(p1[0], p2[0]), y1: Math.min(p1[1], p2[1]), x2: Math.max(p1[0], p2[0]), y2: Math.max(p1[1], p2[1]) });
        break;
      }
      case "S": case "s": case "f": case "F": case "f*": case "B": case "B*": case "b": case "b*":
        out.shapes.push(...path); path = []; cur = null; break;
      case "n": path = []; cur = null; break;
      case "Do": {
        const xo = doc.get(xobjects?.get?.(nameOf(a[a.length - 1])));
        const ref = xobjects?.get?.(nameOf(a[a.length - 1]));
        if (xo instanceof Map && isName(xo.get("Subtype"), "Form")) {
          const m = doc.get(xo.get("Matrix"));
          const data2 = await doc.stream(ref).catch(() => null);
          await runContent(doc, data2, doc.get(xo.get("Resources")) || resources,
            Array.isArray(m) && m.length === 6 ? mul(m, gs.ctm) : gs.ctm, out, depth + 1);
        } else if (xo instanceof Map && isName(xo.get("Subtype"), "Image")) {
          // Where a picture sits (its unit square through the CTM): some forms draw their
          // initials boxes as a picture (BCREA's Subject Removal footer). Never its pixels.
          const p1 = apply(gs.ctm, 0, 0), p2 = apply(gs.ctm, 1, 1);
          out.shapes.push({ image: true, x1: Math.min(p1[0], p2[0]), y1: Math.min(p1[1], p2[1]), x2: Math.max(p1[0], p2[0]), y2: Math.max(p1[1], p2[1]) });
        }
        break;
      }
      default: break;
    }
    ops.length = 0;
  }
}

// ---------------------------------------------------------------- pages

function pageList(doc) {
  const root = doc.get(doc.trailer.get("Root"));
  const pages = [];
  const walk = (ref, inherited, seen = new Set()) => {
    const n = doc.get(ref);
    if (!(n instanceof Map) || seen.has(n)) return;
    seen.add(n);
    const inh = {
      res: n.get("Resources") ?? inherited.res,
      box: n.get("MediaBox") ?? inherited.box,
    };
    if (isName(n.get("Type"), "Page") || (!n.has("Kids") && n.has("Contents"))) { pages.push({ node: n, ...inh }); return; }
    for (const k of doc.get(n.get("Kids")) || []) walk(k, inh, seen);
  };
  walk(root?.get?.("Pages"), {});
  return pages;
}

/** → [{width, height, items: [{str, x, y, w, size}], shapes: [{x1, y1, x2, y2, rect?}]}] per
 *  page, in PDF points from the page's bottom-left (Real Signature's own origin). */
export async function readPdfText(u8) {
  const doc = new Doc(u8);
  await doc.init();
  const out = [];
  for (const p of pageList(doc)) {
    const box = (doc.get(p.box) || [0, 0, 612, 792]).map((v) => doc.get(v));
    const page = { width: box[2] - box[0], height: box[3] - box[1], items: [], shapes: [], fontCache: new Map() };
    const c = doc.get(p.node.get("Contents"));
    const refs = Array.isArray(c) ? c : [p.node.get("Contents")];
    const parts = [];
    for (const r of refs) {
      const d = await doc.stream(r).catch(() => null);
      if (d) parts.push(d, Uint8Array.of(10));
    }
    await runContent(doc, concat(...parts), doc.get(p.res), [1, 0, 0, 1, -box[0], -box[1]], page);
    delete page.fontCache;
    out.push(page);
  }
  return out;
}

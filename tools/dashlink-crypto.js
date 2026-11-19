// Cryptographie offerte aux modules DashLink (DashLink.crypto) : SHA-1, SHA-256, HMAC, AES (ECB, CBC, CTR,
// GCM), ECDH P-256. JavaScript pur, synchrone, vérifié face à la cryptographie d'Android (ModuleCryptoTest).
// Chargé avant DashLink par l'appli et par tools/dashlink.mjs : les deux copies doivent rester identiques.
// shortcut: pas en temps constant (BigInt, tables) ; suffisant pour parler à un écran de moto, pas pour un serveur.
globalThis.__dlCrypto = function (random) {
  "use strict";
  const u8 = (x, what) => {
    if (x instanceof Uint8Array) return x;
    if (ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
    if (Array.isArray(x)) return Uint8Array.from(x);
    throw new TypeError("DashLink.crypto : " + what + " doit être un Uint8Array");
  };
  const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };

  // ---- SHA-1, SHA-256 ----
  // Bourrage : 0x80, des zéros, puis la longueur en bits sur 64 bits gros-boutiste.
  function pad(m) {
    const l = m.length, n = ((l + 9 + 63) >> 6) << 6, o = new Uint8Array(n);
    o.set(m); o[l] = 0x80;
    const bits = l * 8;
    for (let i = 0; i < 4; i++) o[n - 1 - i] = (bits >>> (8 * i)) & 255;
    o[n - 5] = Math.floor(l / 0x20000000) & 255;
    return o;
  }
  const rotl = (x, n) => (x << n) | (x >>> (32 - n));
  function sha1(data) {
    const m = pad(u8(data, "data")), w = new Int32Array(80);
    let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
    for (let o = 0; o < m.length; o += 64) {
      for (let i = 0; i < 16; i++) w[i] = (m[o + 4 * i] << 24) | (m[o + 4 * i + 1] << 16) | (m[o + 4 * i + 2] << 8) | m[o + 4 * i + 3];
      for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
      let a = h0, b = h1, c = h2, d = h3, e = h4;
      for (let i = 0; i < 80; i++) {
        const f = i < 20 ? ((b & c) | (~b & d)) + 0x5a827999 : i < 40 ? (b ^ c ^ d) + 0x6ed9eba1 : i < 60 ? ((b & c) | (b & d) | (c & d)) + 0x8f1bbcdc : (b ^ c ^ d) + 0xca62c1d6;
        const t = (rotl(a, 5) + f + e + w[i]) | 0;
        e = d; d = c; c = rotl(b, 30); b = a; a = t;
      }
      h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
    }
    return words([h0, h1, h2, h3, h4]);
  }
  const K256 = new Int32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  function sha256(data) {
    const m = pad(u8(data, "data")), w = new Int32Array(64);
    const h = new Int32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    for (let o = 0; o < m.length; o += 64) {
      for (let i = 0; i < 16; i++) w[i] = (m[o + 4 * i] << 24) | (m[o + 4 * i + 1] << 16) | (m[o + 4 * i + 2] << 8) | m[o + 4 * i + 3];
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, hh] = h;
      for (let i = 0; i < 64; i++) {
        const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + w[i]) | 0;
        const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
    }
    return words(h);
  }
  function words(ws) { const o = new Uint8Array(ws.length * 4); ws.forEach((v, i) => { o[4 * i] = v >>> 24; o[4 * i + 1] = v >>> 16; o[4 * i + 2] = v >>> 8; o[4 * i + 3] = v; }); return o; }
  function hmac(hash, key, data) {
    key = u8(key, "key"); data = u8(data, "data");
    if (key.length > 64) key = hash(key);
    const k = new Uint8Array(64); k.set(key);
    return hash(cat(k.map((x) => x ^ 0x5c), hash(cat(k.map((x) => x ^ 0x36), data))));
  }

  // ---- AES ----
  const SBOX = new Uint8Array(256), INV = new Uint8Array(256);
  {
    // Boîte S calculée (inverse dans GF(2^8) puis transformation affine) : rien à recopier de travers.
    let p = 1, q = 1;
    do {
      p = p ^ ((p << 1) & 0xff) ^ (p & 0x80 ? 0x1b : 0);
      q ^= q << 1; q ^= q << 2; q ^= q << 4; q &= 0xff; if (q & 0x80) q ^= 0x09;
      const x = q ^ ((q << 1) | (q >> 7)) ^ ((q << 2) | (q >> 6)) ^ ((q << 3) | (q >> 5)) ^ ((q << 4) | (q >> 4));
      SBOX[p] = (x ^ 0x63) & 0xff;
    } while (p !== 1);
    SBOX[0] = 0x63;
    for (let i = 0; i < 256; i++) INV[SBOX[i]] = i;
  }
  const xt = (b) => ((b << 1) ^ (b & 0x80 ? 0x1b : 0)) & 0xff;
  const mul = (a, b) => { let r = 0; while (b) { if (b & 1) r ^= a; a = xt(a); b >>= 1; } return r; };
  function expand(key) {
    key = u8(key, "key");
    const nk = key.length / 4;
    if (![4, 6, 8].includes(nk)) throw new Error("DashLink.crypto : clé AES de 16, 24 ou 32 octets");
    const nr = nk + 6, w = new Uint8Array(16 * (nr + 1));
    w.set(key);
    let rcon = 1;
    for (let i = nk; i < 4 * (nr + 1); i++) {
      let t = w.slice(4 * (i - 1), 4 * i);
      if (i % nk === 0) { t = Uint8Array.of(SBOX[t[1]] ^ rcon, SBOX[t[2]], SBOX[t[3]], SBOX[t[0]]); rcon = xt(rcon); }
      else if (nk > 6 && i % nk === 4) t = t.map((x) => SBOX[x]);
      for (let j = 0; j < 4; j++) w[4 * i + j] = w[4 * (i - nk) + j] ^ t[j];
    }
    return { w, nr };
  }
  function encBlock(k, b) {
    const s = b.slice(0, 16), { w, nr } = k;
    for (let i = 0; i < 16; i++) s[i] ^= w[i];
    for (let r = 1; r <= nr; r++) {
      const t = new Uint8Array(16);
      for (let c = 0; c < 4; c++) for (let row = 0; row < 4; row++) t[4 * c + row] = SBOX[s[4 * ((c + row) % 4) + row]];
      if (r < nr) for (let c = 0; c < 4; c++) {
        const [a0, a1, a2, a3] = t.subarray(4 * c, 4 * c + 4);
        t[4 * c] = xt(a0) ^ xt(a1) ^ a1 ^ a2 ^ a3; t[4 * c + 1] = a0 ^ xt(a1) ^ xt(a2) ^ a2 ^ a3;
        t[4 * c + 2] = a0 ^ a1 ^ xt(a2) ^ xt(a3) ^ a3; t[4 * c + 3] = xt(a0) ^ a0 ^ a1 ^ a2 ^ xt(a3);
      }
      for (let i = 0; i < 16; i++) s[i] = t[i] ^ w[16 * r + i];
    }
    return s;
  }
  function decBlock(k, b) {
    const s = b.slice(0, 16), { w, nr } = k;
    for (let i = 0; i < 16; i++) s[i] ^= w[16 * nr + i];
    for (let r = nr - 1; r >= 0; r--) {
      const t = new Uint8Array(16);
      for (let c = 0; c < 4; c++) for (let row = 0; row < 4; row++) t[4 * ((c + row) % 4) + row] = INV[s[4 * c + row]];
      for (let i = 0; i < 16; i++) t[i] ^= w[16 * r + i];
      if (r > 0) for (let c = 0; c < 4; c++) {
        const [a0, a1, a2, a3] = t.slice(4 * c, 4 * c + 4);
        t[4 * c] = mul(a0, 14) ^ mul(a1, 11) ^ mul(a2, 13) ^ mul(a3, 9); t[4 * c + 1] = mul(a0, 9) ^ mul(a1, 14) ^ mul(a2, 11) ^ mul(a3, 13);
        t[4 * c + 2] = mul(a0, 13) ^ mul(a1, 9) ^ mul(a2, 14) ^ mul(a3, 11); t[4 * c + 3] = mul(a0, 11) ^ mul(a1, 13) ^ mul(a2, 9) ^ mul(a3, 14);
      }
      s.set(t);
    }
    return s;
  }
  const blocks16 = (d) => { if (d.length % 16) throw new Error("DashLink.crypto : longueur multiple de 16 octets attendue"); };
  function ecb(key, data, decrypt) {
    const k = expand(key), d = u8(data, "data"); blocks16(d);
    const o = new Uint8Array(d.length);
    for (let i = 0; i < d.length; i += 16) o.set((decrypt ? decBlock : encBlock)(k, d.subarray(i, i + 16)), i);
    return o;
  }
  function iv16(iv) { iv = u8(iv, "iv"); if (iv.length !== 16) throw new Error("DashLink.crypto : iv de 16 octets"); return iv; }
  function cbcEncrypt(key, iv, data, padding = true) {
    const k = expand(key); let prev = iv16(iv); let d = u8(data, "data");
    if (padding) { const n = 16 - (d.length % 16); d = cat(d, new Uint8Array(n).fill(n)); } else blocks16(d);
    const o = new Uint8Array(d.length);
    for (let i = 0; i < d.length; i += 16) { const x = d.slice(i, i + 16); for (let j = 0; j < 16; j++) x[j] ^= prev[j]; prev = encBlock(k, x); o.set(prev, i); }
    return o;
  }
  function cbcDecrypt(key, iv, data, padding = true) {
    const k = expand(key); let prev = iv16(iv); const d = u8(data, "data"); blocks16(d);
    const o = new Uint8Array(d.length);
    for (let i = 0; i < d.length; i += 16) { const c = d.subarray(i, i + 16), x = decBlock(k, c); for (let j = 0; j < 16; j++) x[j] ^= prev[j]; o.set(x, i); prev = c; }
    if (!padding) return o;
    const n = o[o.length - 1];
    if (!(n >= 1 && n <= 16) || o.subarray(o.length - n).some((x) => x !== n)) throw new Error("DashLink.crypto : bourrage CBC invalide");
    return o.slice(0, o.length - n);
  }
  // CTR : compteur sur les 16 octets du bloc initial, incrémenté en gros-boutiste (comme Java AES/CTR).
  function ctrWith(k, counter, data) {
    const c = counter.slice(), d = u8(data, "data"), o = new Uint8Array(d.length);
    for (let i = 0; i < d.length; i += 16) {
      const ks = encBlock(k, c);
      for (let j = 0; j < 16 && i + j < d.length; j++) o[i + j] = d[i + j] ^ ks[j];
      for (let j = 15; j >= 0; j--) { c[j] = (c[j] + 1) & 255; if (c[j]) break; }
    }
    return o;
  }
  const ctr = (key, iv, data) => ctrWith(expand(key), iv16(iv), data);

  // GCM (NIST SP 800-38D), iv de 12 octets, étiquette de 16 octets à la fin du chiffré.
  function gmul(x, y) {
    const z = new Uint8Array(16), v = y.slice();
    for (let i = 0; i < 128; i++) {
      if (x[i >> 3] & (0x80 >> (i & 7))) for (let j = 0; j < 16; j++) z[j] ^= v[j];
      const lsb = v[15] & 1;
      for (let j = 15; j > 0; j--) v[j] = (v[j] >> 1) | ((v[j - 1] & 1) << 7);
      v[0] >>= 1;
      if (lsb) v[0] ^= 0xe1;
    }
    return z;
  }
  function ghash(h, aad, c) {
    let y = new Uint8Array(16);
    const feed = (d) => { for (let i = 0; i < d.length; i += 16) { const b = new Uint8Array(16); b.set(d.subarray(i, i + 16)); for (let j = 0; j < 16; j++) b[j] ^= y[j]; y = gmul(b, h); } };
    feed(aad); feed(c);
    const len = new Uint8Array(16), dv = new DataView(len.buffer);
    dv.setUint32(4, aad.length * 8); dv.setUint32(12, c.length * 8);
    for (let j = 0; j < 16; j++) len[j] ^= y[j];
    return gmul(len, h);
  }
  function gcmParts(key, iv, aad) {
    const k = expand(key); iv = u8(iv, "iv");
    if (iv.length !== 12) throw new Error("DashLink.crypto : iv GCM de 12 octets");
    const j0 = new Uint8Array(16); j0.set(iv); j0[15] = 1;
    const c1 = j0.slice(); c1[15] = 2;
    return { k, h: encBlock(k, new Uint8Array(16)), j0, c1, aad: aad ? u8(aad, "aad") : new Uint8Array(0) };
  }
  function gcmEncrypt(key, iv, data, aad) {
    const p = gcmParts(key, iv, aad), c = ctrWith(p.k, p.c1, data);
    const t = ghash(p.h, p.aad, c), ek = encBlock(p.k, p.j0);
    for (let j = 0; j < 16; j++) t[j] ^= ek[j];
    return cat(c, t);
  }
  function gcmDecrypt(key, iv, data, aad) {
    const p = gcmParts(key, iv, aad), d = u8(data, "data");
    if (d.length < 16) throw new Error("DashLink.crypto : chiffré GCM trop court");
    const c = d.subarray(0, d.length - 16), tag = d.subarray(d.length - 16);
    const t = ghash(p.h, p.aad, c), ek = encBlock(p.k, p.j0);
    let diff = 0;
    for (let j = 0; j < 16; j++) diff |= (t[j] ^ ek[j]) ^ tag[j];
    if (diff) throw new Error("DashLink.crypto : étiquette GCM invalide (clé, iv ou données)");
    return ctrWith(p.k, p.c1, c);
  }

  // ---- ECDH P-256 ----
  const P = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn;
  const N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
  const B = 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604bn;
  const G = [0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296n, 0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5n];
  const md = (a) => { a %= P; return a < 0n ? a + P : a; };
  const inv = (a) => { let r = 1n, b = md(a), e = P - 2n; while (e) { if (e & 1n) r = r * b % P; b = b * b % P; e >>= 1n; } return r; };
  // Coordonnées jacobiennes (X, Y, Z) : une seule inversion, à la fin ; null = point à l'infini.
  function dbl(p) {
    if (!p) return null;
    const [x, y, z] = p;
    if (y === 0n) return null;
    const delta = z * z % P, gamma = y * y % P, beta = x * gamma % P, alpha = 3n * md(x - delta) * (x + delta) % P;
    const x3 = md(alpha * alpha - 8n * beta);
    const z3 = md((y + z) * (y + z) - gamma - delta);
    return [x3, md(alpha * (4n * beta - x3) - 8n * gamma * gamma), z3];
  }
  function add(p1, p2) {
    if (!p1) return p2; if (!p2) return p1;
    const [x1, y1, z1] = p1, [x2, y2, z2] = p2;
    const z1z1 = z1 * z1 % P, z2z2 = z2 * z2 % P;
    const u1 = x1 * z2z2 % P, u2 = x2 * z1z1 % P, s1 = y1 * z2 % P * z2z2 % P, s2 = y2 * z1 % P * z1z1 % P;
    const h = md(u2 - u1), r = md(2n * (s2 - s1));
    if (h === 0n) return r === 0n ? dbl(p1) : null;
    const i = 4n * h * h % P, j = h * i % P, v = u1 * i % P;
    const x3 = md(r * r - j - 2n * v);
    return [x3, md(r * (v - x3) - 2n * s1 * j), md(((z1 + z2) * (z1 + z2) - z1z1 - z2z2) * h)];
  }
  function mulPt(k, pt) {
    let r = null, a = [pt[0], pt[1], 1n];
    while (k > 0n) { if (k & 1n) r = add(r, a); a = dbl(a); k >>= 1n; }
    if (!r) return null;
    const zi = inv(r[2]), zi2 = zi * zi % P;
    return [r[0] * zi2 % P, r[1] * zi2 % P * zi % P];
  }
  const big = (b) => b.reduce((n, x) => (n << 8n) | BigInt(x), 0n);
  const bytes32 = (n) => { const o = new Uint8Array(32); for (let i = 31; i >= 0; i--) { o[i] = Number(n & 255n); n >>= 8n; } return o; };
  function point(pub) {
    pub = u8(pub, "publicKey");
    if (pub.length !== 65 || pub[0] !== 4) throw new Error("DashLink.crypto : clé publique P-256 non compressée de 65 octets (04 x y)");
    const x = big(pub.subarray(1, 33)), y = big(pub.subarray(33));
    if (x >= P || y >= P || md(y * y - (x * x * x - 3n * x + B)) !== 0n) throw new Error("DashLink.crypto : point hors de la courbe P-256");
    return [x, y];
  }
  const ecdh = Object.freeze({
    /** Paire de clés : privée (32 octets), publique non compressée (65 octets, 04 x y). */
    generate() {
      const d = big(random(32)) % (N - 1n) + 1n, q = mulPt(d, G);
      return { privateKey: bytes32(d), publicKey: cat(Uint8Array.of(4), bytes32(q[0]), bytes32(q[1])) };
    },
    publicKey(priv) { const q = mulPt(big(u8(priv, "privateKey")), G); return cat(Uint8Array.of(4), bytes32(q[0]), bytes32(q[1])); },
    /** Secret partagé : x du point commun (32 octets), comme KeyAgreement « ECDH » de Java. */
    derive(priv, pub) {
      const d = big(u8(priv, "privateKey"));
      if (!(d > 0n && d < N)) throw new Error("DashLink.crypto : clé privée hors limites");
      const s = mulPt(d, point(pub));
      if (!s) throw new Error("DashLink.crypto : secret nul");
      return bytes32(s[0]);
    },
  });

  return Object.freeze({
    sha1, sha256,
    hmacSha1: (key, data) => hmac(sha1, key, data),
    hmacSha256: (key, data) => hmac(sha256, key, data),
    aesEcbEncrypt: (key, data) => ecb(key, data, false), aesEcbDecrypt: (key, data) => ecb(key, data, true),
    aesCbcEncrypt: cbcEncrypt, aesCbcDecrypt: cbcDecrypt, aesCtr: ctr,
    aesGcmEncrypt: gcmEncrypt, aesGcmDecrypt: gcmDecrypt,
    ecdhP256: ecdh,
  });
};

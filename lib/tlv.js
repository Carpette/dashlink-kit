// TLV (type, longueur, valeur), forme fréquente des messages d'écrans. À copier dans ton module.
// Type sur 1 octet, longueur sur 1 ou 2 octets (gros-boutiste) selon l'écran : à adapter à ta capture.

/** Lit une suite de TLV : [{ type, value }]. Lève une erreur sur un message tronqué. */
function tlvRead(u8, lenBytes = 1) {
  const out = [];
  for (let p = 0; p < u8.length;) {
    if (p + 1 + lenBytes > u8.length) throw new Error("TLV tronqué à l'octet " + p);
    const type = u8[p], len = lenBytes === 2 ? (u8[p + 1] << 8) | u8[p + 2] : u8[p + 1];
    const start = p + 1 + lenBytes;
    if (start + len > u8.length) throw new Error("TLV " + type + " : " + len + " octets annoncés, " + (u8.length - start) + " présents");
    out.push({ type, value: u8.subarray(start, start + len) });
    p = start + len;
  }
  return out;
}

/** Écrit une suite de TLV à partir de [{ type, value }]. */
function tlvWrite(items, lenBytes = 1) {
  const parts = [];
  for (const { type, value } of items) {
    if (value.length > (lenBytes === 2 ? 0xffff : 0xff)) throw new Error("TLV " + type + " trop long");
    parts.push(lenBytes === 2 ? [type, value.length >> 8, value.length & 255] : [type, value.length], value);
  }
  const out = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
  let p = 0;
  for (const x of parts) { out.set(x, p); p += x.length; }
  return out;
}

// CRC courants des protocoles d'écrans. À copier dans ton module (le bac à sable n'a pas d'import).
// Valeurs de contrôle sur "123456789" : crc8 0xf4, crc16Ccitt 0x29b1, crc16Xmodem 0x31c3, crc16Modbus 0x4b37, crc32 0xcbf43926.

/** CRC-8, polynôme 0x07, départ 0. */
function crc8(data, poly = 0x07, init = 0) {
  let c = init;
  for (const b of data) { c ^= b; for (let i = 0; i < 8; i++) c = c & 0x80 ? ((c << 1) ^ poly) & 0xff : (c << 1) & 0xff; }
  return c;
}

/** CRC-16 « gros-boutiste » (polynôme 0x1021) : CCITT-FALSE (départ 0xffff) ou XMODEM (départ 0). */
function crc16Ccitt(data, init = 0xffff) {
  let c = init;
  for (const b of data) { c ^= b << 8; for (let i = 0; i < 8; i++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff; }
  return c;
}
const crc16Xmodem = (data) => crc16Ccitt(data, 0);

/** CRC-16 MODBUS (polynôme 0xa001 réfléchi, départ 0xffff). Sur le fil : octet de poids faible d'abord. */
function crc16Modbus(data) {
  let c = 0xffff;
  for (const b of data) { c ^= b; for (let i = 0; i < 8; i++) c = c & 1 ? (c >>> 1) ^ 0xa001 : c >>> 1; }
  return c;
}

/** CRC-32 (zlib, Ethernet). */
function crc32(data) {
  let c = 0xffffffff;
  for (const b of data) { c ^= b; for (let i = 0; i < 8; i++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; }
  return (c ^ 0xffffffff) >>> 0;
}

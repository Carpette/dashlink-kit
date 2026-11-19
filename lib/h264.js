// Vidéo H.264 : ce que DashLink te remet (événement « frame », format h264) est une unité d'accès en Annex B
// (codes de départ 00 00 01 ou 00 00 00 01). À copier dans ton module.

/** Découpe une unité d'accès en NAL (sans les codes de départ) : [{ type, data }]. 7 = SPS, 8 = PPS, 5 = image clé. */
function h264Nals(au) {
  const starts = [];
  for (let i = 0; i + 2 < au.length; i++) if (au[i] === 0 && au[i + 1] === 0 && au[i + 2] === 1) { starts.push(i + 3); i += 2; }
  return starts.map((s, k) => {
    let end = k + 1 < starts.length ? starts[k + 1] - 3 : au.length;
    if (end > s && au[end - 1] === 0 && k + 1 < starts.length) end--; // code de départ sur 4 octets
    return { type: au[s] & 0x1f, data: au.subarray(s, end) };
  });
}

/** RTP (RFC 6184) : une NAL en un ou plusieurs paquets (fragmentation FU-A au-delà de [mtu]). */
function rtpH264(nal, { seq, timestamp, ssrc, payloadType = 96, mtu = 1400, last = true }) {
  const header = (marker) => {
    const h = new Uint8Array(12);
    h[0] = 0x80; h[1] = (marker ? 0x80 : 0) | payloadType; h[2] = (seq >> 8) & 255; h[3] = seq & 255; seq = (seq + 1) & 0xffff;
    for (let i = 0; i < 4; i++) { h[4 + i] = (timestamp >>> (24 - 8 * i)) & 255; h[8 + i] = (ssrc >>> (24 - 8 * i)) & 255; }
    return h;
  };
  const join = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
  if (nal.length <= mtu) return { packets: [join(header(last), nal)], seq };
  const packets = [], fuIndicator = (nal[0] & 0xe0) | 28, type = nal[0] & 0x1f;
  for (let p = 1; p < nal.length; p += mtu - 2) {
    const end = Math.min(nal.length, p + mtu - 2), first = p === 1, final = end === nal.length;
    packets.push(join(header(last && final), Uint8Array.of(fuIndicator, (first ? 0x80 : 0) | (final ? 0x40 : 0) | type), nal.subarray(p, end)));
  }
  return { packets, seq };
}

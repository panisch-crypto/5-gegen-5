// Pure JS ISO/IEC 18004 QR Code SVG Generator (Versions 1 to 6, ECC Level L, Byte Mode)
// Zero external dependencies — works 100% offline and on Cloudflare Pages

const VERSION_PARAMS = [
  null,
  { size: 21, totalCodewords: 26, ecCodewords: 7, align: [] },
  { size: 25, totalCodewords: 44, ecCodewords: 10, align: [6, 18] },
  { size: 29, totalCodewords: 70, ecCodewords: 15, align: [6, 22] },
  { size: 33, totalCodewords: 100, ecCodewords: 20, align: [6, 26] },
  { size: 37, totalCodewords: 134, ecCodewords: 26, align: [6, 30] },
  { size: 41, totalCodewords: 172, ecCodewords: 18, blocks: 2, align: [6, 34] }
];

// GF(256) log/exp tables with primitive polynomial 0x11D
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(degree) {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const root = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], root);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, ecLen) {
  const gen = rsGeneratorPoly(ecLen);
  const msg = new Uint8Array(data.length + ecLen);
  msg.set(data, 0);
  for (let i = 0; i < data.length; i++) {
    const coef = msg[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        msg[i + j] ^= gfMul(gen[j], coef);
      }
    }
  }
  return msg.slice(data.length);
}

function encodeDataCodewords(text) {
  const bytes = new TextEncoder().encode(text);
  // Pick smallest version 1..6 that fits bytes.length in ECC Level L
  let version = 1;
  for (let v = 1; v <= 6; v++) {
    const p = VERSION_PARAMS[v];
    const blocks = p.blocks || 1;
    const dataCap = p.totalCodewords - p.ecCodewords * blocks;
    if (bytes.length + 2 <= dataCap) {
      version = v;
      break;
    }
    if (v === 6) version = 6;
  }

  const p = VERSION_PARAMS[version];
  const blocks = p.blocks || 1;
  const totalDataBytes = p.totalCodewords - p.ecCodewords * blocks;

  const bits = [];
  const pushBits = (val, len) => {
    for (let i = len - 1; i >= 0; i--) {
      bits.push((val >> i) & 1);
    }
  };

  // Byte mode indicator (0100) + 8-bit character count (for v1..9)
  pushBits(0b0100, 4);
  const clipped = bytes.slice(0, totalDataBytes - 2);
  pushBits(clipped.length, 8);
  for (const b of clipped) pushBits(b, 8);

  // Terminator up to 4 zero bits
  const maxBits = totalDataBytes * 8;
  for (let i = 0; i < 4 && bits.length < maxBits; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const dataBytes = new Uint8Array(totalDataBytes);
  for (let i = 0; i < bits.length / 8; i++) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i * 8 + j];
    dataBytes[i] = b;
  }

  let padIdx = Math.floor(bits.length / 8);
  let toggle = true;
  while (padIdx < totalDataBytes) {
    dataBytes[padIdx++] = toggle ? 0xec : 0x11;
    toggle = !toggle;
  }

  if (blocks === 1) {
    const ec = rsEncode(dataBytes, p.ecCodewords);
    const all = new Uint8Array(p.totalCodewords);
    all.set(dataBytes, 0);
    all.set(ec, dataBytes.length);
    return { version, codewords: all };
  } else {
    // 2 equal blocks for version 6-L
    const half = totalDataBytes / 2;
    const b1 = dataBytes.slice(0, half);
    const b2 = dataBytes.slice(half);
    const ec1 = rsEncode(b1, p.ecCodewords);
    const ec2 = rsEncode(b2, p.ecCodewords);
    const all = new Uint8Array(p.totalCodewords);
    let ptr = 0;
    for (let i = 0; i < half; i++) {
      all[ptr++] = b1[i];
      all[ptr++] = b2[i];
    }
    for (let i = 0; i < p.ecCodewords; i++) {
      all[ptr++] = ec1[i];
      all[ptr++] = ec2[i];
    }
    return { version, codewords: all };
  }
}

export function renderQRCodeSVG(text, pixelSize = 180) {
  const { version, codewords } = encodeDataCodewords(text);
  const { size, align } = VERSION_PARAMS[version];

  const grid = Array.from({ length: size }, () => new Uint8Array(size));
  const reserved = Array.from({ length: size }, () => new Uint8Array(size));

  const setModule = (r, c, val, isFunc = true) => {
    if (r < 0 || r >= size || c < 0 || c >= size) return;
    grid[r][c] = val ? 1 : 0;
    if (isFunc) reserved[r][c] = 1;
  };

  // Finder patterns + separators
  const placeFinder = (row, col) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const inOuter = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        const onBorder = r === 0 || r === 6 || c === 0 || c === 6;
        const inInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        setModule(row + r, col + c, inOuter && (onBorder || inInner), true);
      }
    }
  };
  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // Alignment patterns
  if (align.length > 0) {
    for (const ar of align) {
      for (const ac of align) {
        if ((ar === 6 && ac === 6) || (ar === 6 && ac === size - 7) || (ar === size - 7 && ac === 6)) {
          continue;
        }
        for (let r = -2; r <= 2; r++) {
          for (let c = -2; c <= 2; c++) {
            const dark = Math.max(Math.abs(r), Math.abs(c)) !== 1;
            setModule(ar + r, ac + c, dark, true);
          }
        }
      }
    }
  }

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    if (!reserved[6][i]) setModule(6, i, i % 2 === 0, true);
    if (!reserved[i][6]) setModule(i, 6, i % 2 === 0, true);
  }

  // Dark module & reserve format info areas
  setModule(size - 8, 8, 1, true);
  for (let i = 0; i < 9; i++) {
    if (!reserved[8][i]) reserved[8][i] = 1;
    if (!reserved[i][8]) reserved[i][8] = 1;
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][size - 1 - i] = 1;
    reserved[size - 1 - i][8] = 1;
  }

  // Place data bits in upward/downward 2-column zig-zag
  let bitIdx = 0;
  const totalBits = codewords.length * 8;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      const r = upward ? size - 1 - vert : vert;
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        if (!reserved[r][c]) {
          let bit = 0;
          if (bitIdx < totalBits) {
            bit = (codewords[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1;
            bitIdx++;
          }
          // Apply Mask 0: (r + c) % 2 === 0
          if ((r + c) % 2 === 0) bit ^= 1;
          grid[r][c] = bit;
        }
      }
    }
    upward = !upward;
  }

  // Format information for ECC Level L (01) + Mask 0 (000) -> precomputed BCH bits: 0x77C4 (30660)
  const formatBits = 0x77c4;
  const fCoords1 = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]
  ];
  for (let i = 0; i < 15; i++) {
    const bit = (formatBits >> i) & 1;
    const [r, c] = fCoords1[i];
    grid[r][c] = bit;
    if (i < 7) {
      grid[size - 1 - i][8] = bit;
    } else {
      grid[8][size - 15 + i] = bit;
    }
  }

  const quiet = 2;
  const fullSize = size + quiet * 2;
  let paths = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (grid[r][c]) {
        paths += `M${c + quiet},${r + quiet}h1v1h-1z`;
      }
    }
  }

  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fullSize} ${fullSize}" width="${pixelSize}" height="${pixelSize}" shape-rendering="crispEdges" role="img" aria-label="QR Code">
      <rect width="${fullSize}" height="${fullSize}" fill="#FFFFFF" />
      <path d="${paths}" fill="#090C15" />
    </svg>
  `;
}

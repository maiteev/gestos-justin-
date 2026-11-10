// Gestos Justin Bieber — metadatos y lógica de detección.
//
// Este módulo es puro (no toca el DOM ni MediaPipe), así que se puede probar
// con landmarks sintéticos desde Node. Recibe los resultados de dos modelos:
//   - PoseLandmarker: 33 puntos del cuerpo (hombros, codos, muñecas, orejas…)
//   - HandLandmarker: 21 puntos por mano (dedos)
//
// Todas las distancias se normalizan por el ancho de hombros ("sw"), así los
// umbrales no dependen de qué tan lejos estés de la cámara.

export const GESTURES = [
  {
    id: "timido",
    n: 1,
    name: "Tímido",
    how: "Mano plana en la nuca tras la oreja, con el brazo flexionado y el codo hacia afuera.",
    img: "new-memes/timido.jpeg",
  },
  {
    id: "nose",
    n: 2,
    name: "Nose",
    how: "Brazos extendidos en diagonal hacia abajo, con las palmas al frente y los dedos abiertos.",
    img: "new-memes/nose.jpeg",
  },
  {
    id: "strong",
    n: 3,
    name: "Stay Strong",
    how: "Brazo extendido hacia la cámara con la mano en primer plano y los dedos semicurvados.",
    img: "new-memes/strong.jpeg",
  },
  {
    id: "helly",
    n: 4,
    name: "What the helly",
    how: "Puño cerrado bajo la barbilla cubierto por la otra palma, con los codos pegados al torso.",
    img: "new-memes/helly.jpeg",
  },
  {
    id: "mandarinas",
    n: 5,
    name: "45 Mandarinas",
    how: "Manos a la altura del cuello con los codos doblados y los dedos flexionados bajo el pulgar.",
    img: "new-memes/mandarinas.jpeg",
  },
  {
    id: "corazon",
    n: 6,
    name: "Corazón",
    how: "Mano plana cruzada en el centro del pecho con el pulgar hacia arriba y el otro brazo relajado.",
    img: "new-memes/corazon.jpeg",
  },
];

// Umbrales ajustables. Todo está en unidades de "ancho de hombros" salvo que
// se indique otra cosa. Si un gesto no se activa (o se activa de más), este es
// el único lugar que hay que tocar.
export const THRESHOLDS = {
  minVisibility: 0.5, // visibilidad mínima de un punto del cuerpo para usarlo
  minShoulderWidth: 0.08, // ancho de hombros mínimo (fracción del alto de imagen)

  // Tímido
  timidoWristToEar: 0.6,
  timidoElbowOut: 0.7,

  // Nose: ambas muñecas claramente hacia afuera de los hombros, sin exigir pendiente ni codo recto
  // (con la cámara de un computador las muñecas suelen quedar al borde del cuadro).
  limbVisibility: 0.1,
  noseMinOutward: 1.1, // distancia de cada muñeca al centro del torso, en anchos de hombro
  noseMaxAboveShoulder: 0.3, // la muñeca no puede estar más arriba que esto sobre el hombro

  // Stay Strong: mano mucho más cerca de la cámara que el cuerpo, y NO sobre la cara.
  strongHandToShoulders: 0.45, // tamaño de la mano / ancho de hombros
  strongHandScaleAbs: 0.3, // solo se usa si no se ve el cuerpo
  strongWristForward: 0.9, // alternativa: muñeca más cerca que el hombro por este factor (profundidad z)
  strongMaxBendDeg: 100, // sobre esto es un puño cerrado
  strongFaceDist: 0.5, // mano a menos de esto (en anchos de hombro) de la nariz = mano en la cara

  // What the helly
  hellyWristsGap: 0.7,
  hellyWristFromNose: 0.8,
  hellyElbowMax: 0.85,

  // 45 Mandarinas
  mandarinasWristsGapMin: 0.7,
  mandarinasWristFromCenter: 1.4,
  mandarinasElbowMaxDeg: 130,

  // Corazón
  corazonWristFromCenter: 0.5,
  corazonOtherArmLow: 1.2,
};

// ---------------------------------------------------------------- geometría
const POSE = { NOSE: 0, L_EAR: 7, R_EAR: 8, L_SH: 11, R_SH: 12, L_EL: 13, R_EL: 14, L_WR: 15, R_WR: 16 };

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// ángulo en el vértice b del triángulo a-b-c, en grados
function angleAt(a, b, c) {
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const m = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
  if (m < 1e-9) return 180;
  const cos = Math.min(1, Math.max(-1, (v1.x * v2.x + v1.y * v2.y) / m));
  return (Math.acos(cos) * 180) / Math.PI;
}

// ángulo de flexión de un dedo: 0° = dedo recto, ~120° = dedo cerrado en puño
function fingerBend(lm, mcp, pip, tip) {
  const a = { x: lm[pip].x - lm[mcp].x, y: lm[pip].y - lm[mcp].y };
  const b = { x: lm[tip].x - lm[pip].x, y: lm[tip].y - lm[pip].y };
  const m = Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y);
  if (m < 1e-9) return 0;
  const cos = Math.min(1, Math.max(-1, (a.x * b.x + a.y * b.y) / m));
  return (Math.acos(cos) * 180) / Math.PI;
}

export function handInfo(landmarks, aspect) {
  const lm = landmarks.map((p) => ({ x: p.x * aspect, y: p.y }));
  const bends = [
    fingerBend(lm, 5, 6, 8),
    fingerBend(lm, 9, 10, 12),
    fingerBend(lm, 13, 14, 16),
    fingerBend(lm, 17, 18, 20),
  ];
  return {
    cx: lm[9].x,
    cy: lm[9].y,
    scale: dist(lm[0], lm[9]), // muñeca → base del dedo medio, en alto de imagen
    meanBend: bends.reduce((s, v) => s + v, 0) / 4,
    curled: bends.filter((b) => b >= 45).length,
  };
}

function buildPose(pose, aspect, cfg) {
  const pt = (i) => ({
    x: pose[i].x * aspect,
    y: pose[i].y,
    z: (pose[i].z ?? 0) * aspect,
    v: pose[i].visibility ?? 1,
  });
  const P = {};
  for (const [k, i] of Object.entries(POSE)) P[k] = pt(i);
  const sw = dist(P.L_SH, P.R_SH);
  if (sw < cfg.minShoulderWidth) return null;
  P.sw = sw;
  P.center = { x: (P.L_SH.x + P.R_SH.x) / 2, y: (P.L_SH.y + P.R_SH.y) / 2 };
  P.vis = (...names) => names.every((n) => P[n].v >= cfg.minVisibility);
  return P;
}

// ----------------------------------------------------------- cada gesto
function noseArm(P, sh, wr, c) {
  const S = P[sh], W = P[wr];
  const out = Math.abs(W.x - P.center.x) / P.sw;
  const dy = (W.y - S.y) / P.sw;
  const ok =
    S.v >= c.minVisibility &&
    W.v >= c.limbVisibility &&
    out > c.noseMinOutward &&
    dy > -c.noseMaxAboveShoulder;
  return { ok, text: `out ${out.toFixed(2)} dy ${dy.toFixed(2)} vis ${W.v.toFixed(2)}` };
}

function isNose(P, c, debug) {
  const l = noseArm(P, "L_SH", "L_WR", c);
  const r = noseArm(P, "R_SH", "R_WR", c);
  debug.nose = `L ${l.text} | R ${r.text}  (need out>${c.noseMinOutward})`;
  return l.ok && r.ok;
}

function isTimido(P, c) {
  const side = (ear, sh, el, wr) => {
    if (!P.vis(ear, sh, el, wr)) return false;
    return (
      dist(P[wr], P[ear]) / P.sw < c.timidoWristToEar && // mano junto a la oreja
      Math.abs(P[el].x - P.center.x) > c.timidoElbowOut * P.sw && // codo hacia afuera
      P[el].y < P[sh].y + 0.4 * P.sw && // codo a la altura del hombro o más arriba
      P[wr].y < P[sh].y // mano sobre la línea de hombros
    );
  };
  return side("L_EAR", "L_SH", "L_EL", "L_WR") || side("R_EAR", "R_SH", "R_EL", "R_WR");
}

function isHelly(P, c) {
  if (!P.vis("NOSE", "L_SH", "R_SH", "L_EL", "R_EL", "L_WR", "R_WR")) return false;
  const chinY = P.NOSE.y + 0.2 * P.sw;
  const lowY = P.center.y + 0.5 * P.sw;
  const wr = [P.L_WR, P.R_WR];
  const el = [P.L_EL, P.R_EL];
  return (
    wr.every((w) => w.y > chinY && w.y < lowY) &&
    wr.every((w) => Math.abs(w.x - P.NOSE.x) < c.hellyWristFromNose * P.sw) &&
    dist(P.L_WR, P.R_WR) < c.hellyWristsGap * P.sw && // manos juntas
    el.every((e) => Math.abs(e.x - P.center.x) < c.hellyElbowMax * P.sw) && // codos pegados
    el.every((e, i) => e.y > wr[i].y) // codos bajo las manos
  );
}

function isMandarinas(P, c) {
  if (!P.vis("NOSE", "L_SH", "R_SH", "L_EL", "R_EL", "L_WR", "R_WR")) return false;
  const topY = P.NOSE.y + 0.2 * P.sw;
  const botY = P.center.y + 0.35 * P.sw;
  const wr = [P.L_WR, P.R_WR];
  return (
    wr.every((w) => w.y > topY && w.y < botY) && // altura del cuello
    wr.every((w) => Math.abs(w.x - P.center.x) < c.mandarinasWristFromCenter * P.sw) &&
    dist(P.L_WR, P.R_WR) >= c.mandarinasWristsGapMin * P.sw && // manos separadas (si no, es "helly")
    angleAt(P.L_SH, P.L_EL, P.L_WR) < c.mandarinasElbowMaxDeg &&
    angleAt(P.R_SH, P.R_EL, P.R_WR) < c.mandarinasElbowMaxDeg &&
    P.L_EL.y > P.L_WR.y &&
    P.R_EL.y > P.R_WR.y
  );
}

function isCorazon(P, c) {
  const side = (sh, el, wr, oWr) => {
    if (!P.vis(sh, wr)) return false;
    const w = P[wr];
    const onChest =
      Math.abs(w.x - P.center.x) < c.corazonWristFromCenter * P.sw &&
      w.y > P.center.y + 0.2 * P.sw &&
      w.y < P.center.y + 1.2 * P.sw;
    // el otro brazo cuelga relajado (o ni siquiera sale en cuadro)
    const o = P[oWr];
    const otherRelaxed = o.v < c.minVisibility || o.y > P.center.y + c.corazonOtherArmLow * P.sw;
    return onChest && otherRelaxed;
  };
  return side("L_SH", "L_EL", "L_WR", "R_WR") || side("R_SH", "R_EL", "R_WR", "L_WR");
}

function strongInfo(h, P, c) {
  const ratio = P ? h.scale / P.sw : null;
  const bigHand = P ? ratio > c.strongHandToShoulders : h.scale > c.strongHandScaleAbs;
  // brazo estirado hacia la cámara: alguna muñeca claramente más adelante que su hombro
  let forward = null;
  if (P) {
    const zs = [["L_SH", "L_WR"], ["R_SH", "R_WR"]]
      .filter(([s, w]) => P[s].v >= c.minVisibility && P[w].v >= c.limbVisibility)
      .map(([s, w]) => (P[w].z - P[s].z) / P.sw);
    if (zs.length) forward = Math.min(...zs);
  }
  const armForward = forward !== null && forward < -c.strongWristForward;
  const faceDist = P && P.NOSE.v >= c.limbVisibility ? dist({ x: h.cx, y: h.cy }, P.NOSE) / P.sw : null;
  const onFace = faceDist !== null && faceDist < c.strongFaceDist;
  const notFist = h.meanBend <= c.strongMaxBendDeg;
  return { ok: (bigHand || armForward) && notFist && !onFace, ratio, faceDist, forward };
}

function isStrong(hands, P, c, debug) {
  const infos = hands.map((h) => strongInfo(h, P, c));
  if (infos.length) {
    debug.strongRatio = infos[0].ratio;
    debug.strongFace = infos[0].faceDist;
    debug.strongForward = infos[0].forward;
  }
  return infos.some((i) => i.ok);
}

/**
 * @param {Array|null} pose   landmarks de pose (33 puntos) o null
 * @param {Array} handsLm     array de manos, cada una con 21 landmarks
 * @param {number} aspect     ancho/alto del video (para que x e y tengan la misma escala)
 * @returns {{id: string|null, debug: object}}
 */
export function detectGesture(pose, handsLm, aspect, cfg = THRESHOLDS) {
  const hands = (handsLm || []).map((h) => handInfo(h, aspect));
  const debug = {
    shoulderWidth: null,
    handScale: hands.length ? Math.max(...hands.map((h) => h.scale)) : null,
    hands: hands.length,
    handBend: hands.length ? hands[0].meanBend : null,
    nose: null,
    strongRatio: null,
    strongFace: null,
    strongForward: null,
  };

  const P = pose ? buildPose(pose, aspect, cfg) : null;
  if (P) debug.shoulderWidth = P.sw;

  // orden = prioridad cuando dos gestos se parecen
  if (P && isNose(P, cfg, debug)) return { id: "nose", debug };
  if (isStrong(hands, P, cfg, debug)) return { id: "strong", debug };
  if (P && isHelly(P, cfg)) return { id: "helly", debug };
  if (P && isMandarinas(P, cfg)) return { id: "mandarinas", debug };
  if (P && isCorazon(P, cfg)) return { id: "corazon", debug };
  if (P && isTimido(P, cfg)) return { id: "timido", debug };
  return { id: null, debug };
}

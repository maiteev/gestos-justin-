import {
  HandLandmarker,
  PoseLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";
import { GESTURES, detectGesture } from "./gestures.js";

// ---- meme mapping -----------------------------------------------------
// Los 6 gestos de Justin viven en gestures.js (con sus umbrales de detección).
// "default" es lo que se muestra cuando no se detecta ningún gesto: la imagen de basketball.
const GESTURE_MEMES = {
  default: ["new-memes/basketball.jpeg"],
};
for (const g of GESTURES) GESTURE_MEMES[g.id] = [g.img];

// how many consecutive frames a gesture must hold before we switch to it
const STABLE_FRAMES_REQUIRED = 5;
// if no hand / no gesture is seen for this long, fall back to default
const DEFAULT_FALLBACK_MS = 600;
const video = document.getElementById("video");
const memeImg = document.getElementById("memeImg");
const debugHud = document.getElementById("debugHud");

let handLandmarker, poseLandmarker;
let lastVideoTime = -1;
let currentGesture = "default";
let candidateGesture = "default";
let candidateStreak = 0;
let lastNonDefaultAt = performance.now();
let lastDebug = { shoulderWidth: null, handScale: null, hands: 0 };

async function init() {
  const fileset = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );

  handLandmarker = await HandLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numHands: 2,
  });

  poseLandmarker = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numPoses: 1,
  });

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480 },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();

  requestAnimationFrame(loop);
}

function pickImage(gesture) {
  const images = GESTURE_MEMES[gesture];
  return images[Math.floor(Math.random() * images.length)];
}

function applyGesture(gesture) {
  if (gesture === currentGesture) return;
  currentGesture = gesture;
  memeImg.src = pickImage(gesture);
}

function loop() {
  const now = performance.now();
  if (video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const ts = performance.now();

    const handResult = handLandmarker.detectForVideo(video, ts);
    const poseResult = poseLandmarker.detectForVideo(video, ts);

    const { id, debug } = detectGesture(
      poseResult.landmarks?.[0] ?? null,
      handResult.landmarks ?? [],
      video.videoWidth / video.videoHeight
    );
    lastDebug = debug;
    const gesture = id ?? "default";

    // debounce: require a gesture to be seen for several consecutive
    // frames before we commit to it, to avoid flicker between frames
    if (gesture === candidateGesture) {
      candidateStreak++;
    } else {
      candidateGesture = gesture;
      candidateStreak = 1;
    }

    if (candidateStreak >= STABLE_FRAMES_REQUIRED) {
      applyGesture(gesture);
    }

    if (gesture !== "default") lastNonDefaultAt = now;
    if (now - lastNonDefaultAt > DEFAULT_FALLBACK_MS && currentGesture !== "default") {
      applyGesture("default");
    }

    updateDebugHud();
  }
  requestAnimationFrame(loop);
}

function updateDebugHud() {
  if (!debugHud) return;
  const f = (v) => (v == null ? "-" : v.toFixed(2));
  debugHud.textContent =
    `gesture: ${currentGesture}\n` +
    `shoulders: ${f(lastDebug.shoulderWidth)}  hands: ${lastDebug.hands}  hand size: ${f(lastDebug.handScale)}  bend: ${f(lastDebug.handBend)}\n` +
    `strong: hand/shoulders ${f(lastDebug.strongRatio)} (need >0.45)  hand-to-nose ${f(lastDebug.strongFace)} (need >0.5)  wrist-forward ${f(lastDebug.strongForward)} (need <-0.9)\n` +
    `nose: ${lastDebug.nose ?? "-"}`;
}

init().catch((err) => console.error(err));

import { useRef, useState, useCallback } from "react";
import * as ort from "onnxruntime-web";

export interface Detection {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  score: number;
}

const INPUT_SIZE = 320;
const IOU_THRESHOLD = 0.45;

function iou(a: Detection, b: Detection): number {
  const ix1 = Math.max(a.x1, b.x1);
  const iy1 = Math.max(a.y1, b.y1);
  const ix2 = Math.min(a.x2, b.x2);
  const iy2 = Math.min(a.y2, b.y2);
  const inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
  const aArea = (a.x2 - a.x1) * (a.y2 - a.y1);
  const bArea = (b.x2 - b.x1) * (b.y2 - b.y1);
  return inter / (aArea + bArea - inter + 1e-6);
}

function nms(dets: Detection[]): Detection[] {
  const sorted = [...dets].sort((a, b) => b.score - a.score);
  const keep: Detection[] = [];
  const suppressed = new Set<number>();
  for (let i = 0; i < sorted.length; i++) {
    if (suppressed.has(i)) continue;
    keep.push(sorted[i]);
    for (let j = i + 1; j < sorted.length; j++) {
      if (iou(sorted[i], sorted[j]) > IOU_THRESHOLD) suppressed.add(j);
    }
  }
  return keep;
}

function preprocessImage(source: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement): Float32Array {
  const canvas = document.createElement("canvas");
  canvas.width = INPUT_SIZE;
  canvas.height = INPUT_SIZE;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(source, 0, 0, INPUT_SIZE, INPUT_SIZE);
  const { data } = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
  const tensor = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
  for (let i = 0; i < INPUT_SIZE * INPUT_SIZE; i++) {
    tensor[i] = data[i * 4] / 255;
    tensor[INPUT_SIZE * INPUT_SIZE + i] = data[i * 4 + 1] / 255;
    tensor[2 * INPUT_SIZE * INPUT_SIZE + i] = data[i * 4 + 2] / 255;
  }
  return tensor;
}

// Parse YOLOv8 output: shape [1, 5, N] or [1, N, 5]
function parseOutput(output: ort.Tensor, origW: number, origH: number, confThreshold: number): Detection[] {
  const data = output.data as Float32Array;
  const dims = output.dims;
  const dets: Detection[] = [];

  // dims: [1, 5, N] — YOLOv8 format (cx, cy, w, h, conf)
  if (dims.length === 3 && dims[1] === 5) {
    const N = dims[2];
    for (let i = 0; i < N; i++) {
      const cx = data[0 * N + i];
      const cy = data[1 * N + i];
      const w  = data[2 * N + i];
      const h  = data[3 * N + i];
      const score = data[4 * N + i];
      if (score < confThreshold) continue;
      dets.push({
        x1: ((cx - w / 2) / INPUT_SIZE) * origW,
        y1: ((cy - h / 2) / INPUT_SIZE) * origH,
        x2: ((cx + w / 2) / INPUT_SIZE) * origW,
        y2: ((cy + h / 2) / INPUT_SIZE) * origH,
        score,
      });
    }
  }
  // dims: [1, N, 5] — transposed
  else if (dims.length === 3 && dims[2] === 5) {
    const N = dims[1];
    for (let i = 0; i < N; i++) {
      const base = i * 5;
      const cx = data[base];
      const cy = data[base + 1];
      const w  = data[base + 2];
      const h  = data[base + 3];
      const score = data[base + 4];
      if (score < confThreshold) continue;
      dets.push({
        x1: ((cx - w / 2) / INPUT_SIZE) * origW,
        y1: ((cy - h / 2) / INPUT_SIZE) * origH,
        x2: ((cx + w / 2) / INPUT_SIZE) * origW,
        y2: ((cy + h / 2) / INPUT_SIZE) * origH,
        score,
      });
    }
  }

  return nms(dets);
}

export function useOnnxModel() {
  const sessionRef = useRef<ort.InferenceSession | null>(null);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);

  const initSession = useCallback(async (buffer: ArrayBuffer) => {
    ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/";
    sessionRef.current = await ort.InferenceSession.create(buffer, {
      executionProviders: ["wasm"],
    });
    setModelLoaded(true);
  }, []);

  const loadModel = useCallback(async (file: File) => {
    setLoading(true);
    setModelError(null);
    try {
      const buffer = await file.arrayBuffer();
      await initSession(buffer);
    } catch (e: unknown) {
      setModelError("Не удалось загрузить модель: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  }, [initSession]);

  const loadModelFromBuffer = useCallback(async (buffer: ArrayBuffer) => {
    setLoading(true);
    setModelError(null);
    try {
      await initSession(buffer);
    } catch (e: unknown) {
      setModelError("Не удалось загрузить модель: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  }, [initSession]);

  const runInference = useCallback(
    async (
      source: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement,
      origW: number,
      origH: number,
      confThreshold: number = 0.4
    ): Promise<Detection[]> => {
      if (!sessionRef.current) return [];
      const inputData = preprocessImage(source);
      const tensor = new ort.Tensor("float32", inputData, [1, 3, INPUT_SIZE, INPUT_SIZE]);
      const inputName = sessionRef.current.inputNames[0];
      const results = await sessionRef.current.run({ [inputName]: tensor });
      const outputName = sessionRef.current.outputNames[0];
      return parseOutput(results[outputName], origW, origH, confThreshold);
    },
    []
  );

  return { loadModel, loadModelFromBuffer, runInference, modelLoaded, loading, modelError };
}
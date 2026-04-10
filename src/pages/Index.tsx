import { useRef, useState, useCallback, useEffect } from "react";
import Icon from "@/components/ui/icon";
import { useOnnxModel, Detection } from "@/hooks/useOnnxModel";

type Mode = "idle" | "photo" | "video" | "preview-photo" | "preview-video";

export default function Index() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const rafRef = useRef<number>(0);
  const inferringRef = useRef(false);

  const [mode, setMode] = useState<Mode>("idle");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [detections, setDetections] = useState<Detection[]>([]);

  const { loadModel, runInference, modelLoaded, loading: modelLoading, modelError } = useOnnxModel();

  const stopStream = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const startCamera = useCallback(async (forVideo = false) => {
    setCamError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: forVideo,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch {
      setCamError("Нет доступа к камере. Разрешите доступ в настройках браузера.");
    }
  }, []);

  // Live inference loop
  useEffect(() => {
    if ((mode !== "photo" && mode !== "video") || !modelLoaded) return;

    const loop = async () => {
      const video = videoRef.current;
      const overlay = overlayCanvasRef.current;
      if (!video || !overlay || video.readyState < 2) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }
      const W = video.videoWidth;
      const H = video.videoHeight;
      if (W === 0 || H === 0) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }
      overlay.width = W;
      overlay.height = H;

      if (!inferringRef.current) {
        inferringRef.current = true;
        try {
          const dets = await runInference(video, W, H);
          setDetections(dets);
          const ctx = overlay.getContext("2d");
          if (ctx) {
            ctx.clearRect(0, 0, W, H);
            for (const d of dets) {
              ctx.strokeStyle = "#facc15";
              ctx.lineWidth = 2.5;
              ctx.strokeRect(d.x1, d.y1, d.x2 - d.x1, d.y2 - d.y1);
              ctx.fillStyle = "rgba(250,204,21,0.12)";
              ctx.fillRect(d.x1, d.y1, d.x2 - d.x1, d.y2 - d.y1);
            }
          }
        } finally {
          inferringRef.current = false;
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [mode, modelLoaded, runInference]);

  const handlePhoto = useCallback(async () => {
    setMode("photo");
    setDetections([]);
    await startCamera(false);
  }, [startCamera]);

  const handleVideo = useCallback(async () => {
    setMode("video");
    setDetections([]);
    await startCamera(true);
  }, [startCamera]);

  const takePhoto = useCallback(async () => {
    const video = videoRef.current;
    const canvas = captureCanvasRef.current;
    const overlay = overlayCanvasRef.current;
    if (!video || !canvas) return;

    const W = video.videoWidth;
    const H = video.videoHeight;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(video, 0, 0);
    if (overlay) ctx.drawImage(overlay, 0, 0);

    if (detections.length > 0) {
      const label = `Монет: ${detections.length}`;
      ctx.font = `bold ${Math.round(H * 0.04)}px Golos Text, sans-serif`;
      const tw = ctx.measureText(label).width;
      const pad = 14;
      const bh = Math.round(H * 0.06);
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(W / 2 - tw / 2 - pad, H - bh - 16, tw + pad * 2, bh);
      ctx.fillStyle = "#facc15";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, W / 2, H - 16 - bh / 2);
    }

    const url = canvas.toDataURL("image/jpeg", 0.92);
    setPhotoUrl(url);
    stopStream();
    setMode("preview-photo");
  }, [detections, stopStream]);

  const startRecording = useCallback(() => {
    if (!streamRef.current) return;
    chunksRef.current = [];
    const recorder = new MediaRecorder(streamRef.current);
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: "video/webm" });
      const url = URL.createObjectURL(blob);
      setVideoUrl(url);
      stopStream();
      setMode("preview-video");
      setIsRecording(false);
    };
    mediaRecorderRef.current = recorder;
    recorder.start();
    setIsRecording(true);
  }, [stopStream]);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
  }, []);

  const savePhoto = useCallback(() => {
    if (!photoUrl) return;
    const a = document.createElement("a");
    a.href = photoUrl;
    a.download = `coins_${Date.now()}.jpg`;
    a.click();
  }, [photoUrl]);

  const saveVideo = useCallback(() => {
    if (!videoUrl) return;
    const a = document.createElement("a");
    a.href = videoUrl;
    a.download = `coins_${Date.now()}.webm`;
    a.click();
  }, [videoUrl]);

  const reset = useCallback(() => {
    stopStream();
    setMode("idle");
    setPhotoUrl(null);
    setVideoUrl(null);
    setIsRecording(false);
    setCamError(null);
    setDetections([]);
  }, [stopStream]);

  const handleModelFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) loadModel(file);
    },
    [loadModel]
  );

  const isCameraMode = mode === "photo" || mode === "video";

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-logo">LENS</span>
        <div className="header-right">
          <label className={`model-btn ${modelLoaded ? "model-btn--ok" : ""}`}>
            {modelLoading ? (
              <Icon name="Loader" size={14} />
            ) : modelLoaded ? (
              <Icon name="CheckCircle" size={14} />
            ) : (
              <Icon name="Upload" size={14} />
            )}
            <span>{modelLoaded ? "Модель загружена" : "Загрузить модель"}</span>
            <input type="file" accept=".onnx" className="hidden" onChange={handleModelFile} />
          </label>
          {mode !== "idle" && (
            <button className="btn-ghost" onClick={reset}>
              <Icon name="X" size={20} />
            </button>
          )}
        </div>
      </header>

      {modelError && <p className="error-msg model-error">{modelError}</p>}

      <main className="app-main">
        {/* IDLE */}
        {mode === "idle" && (
          <div className="idle-screen">
            {!modelLoaded && (
              <div className="model-hint">
                <Icon name="Info" size={15} />
                <span>Загрузите .onnx модель для распознавания монет</span>
              </div>
            )}
            <p className="idle-hint">Выберите режим съёмки</p>
            <div className="action-grid">
              <button className="action-card" onClick={handlePhoto}>
                <div className="action-icon-wrap">
                  <Icon name="Camera" size={36} />
                </div>
                <span className="action-label">Фото</span>
                <span className="action-sub">сделать снимок</span>
              </button>
              <button className="action-card" onClick={handleVideo}>
                <div className="action-icon-wrap">
                  <Icon name="Video" size={36} />
                </div>
                <span className="action-label">Видео</span>
                <span className="action-sub">записать видео</span>
              </button>
            </div>
            {camError && <p className="error-msg">{camError}</p>}
          </div>
        )}

        {/* CAMERA */}
        {isCameraMode && (
          <div className="camera-screen">
            <div className="viewfinder">
              <video ref={videoRef} className="camera-feed" playsInline muted />
              <canvas ref={overlayCanvasRef} className="overlay-canvas" />
              <div className="vf-corners">
                <span /><span /><span /><span />
              </div>
              {isRecording && (
                <div className="rec-badge">
                  <span className="rec-dot" />
                  REC
                </div>
              )}
            </div>

            {camError && <p className="error-msg">{camError}</p>}

            <div className="coin-counter">
              <Icon name="Coins" size={17} />
              <span>Монет: <strong>{detections.length}</strong></span>
              {!modelLoaded && <span className="counter-hint">(нет модели)</span>}
            </div>

            <div className="shutter-bar">
              {mode === "photo" && (
                <button className="shutter-btn" onClick={takePhoto}>
                  <Icon name="Camera" size={28} />
                </button>
              )}
              {mode === "video" && !isRecording && (
                <button className="shutter-btn shutter-btn--record" onClick={startRecording}>
                  <Icon name="Circle" size={28} />
                </button>
              )}
              {mode === "video" && isRecording && (
                <button className="shutter-btn shutter-btn--stop" onClick={stopRecording}>
                  <Icon name="Square" size={24} />
                </button>
              )}
            </div>
          </div>
        )}

        {/* PHOTO PREVIEW */}
        {mode === "preview-photo" && photoUrl && (
          <div className="preview-screen">
            <div className="preview-wrap">
              <img src={photoUrl} className="preview-media" alt="снимок" />
            </div>
            <div className="preview-actions">
              <button className="btn-primary" onClick={savePhoto}>
                <Icon name="Download" size={18} />
                Сохранить фото
              </button>
              <button className="btn-secondary" onClick={reset}>
                Снять ещё
              </button>
            </div>
          </div>
        )}

        {/* VIDEO PREVIEW */}
        {mode === "preview-video" && videoUrl && (
          <div className="preview-screen">
            <div className="preview-wrap">
              <video src={videoUrl} className="preview-media" controls />
            </div>
            <div className="preview-actions">
              <button className="btn-primary" onClick={saveVideo}>
                <Icon name="Download" size={18} />
                Сохранить видео
              </button>
              <button className="btn-secondary" onClick={reset}>
                Записать ещё
              </button>
            </div>
          </div>
        )}
      </main>

      <canvas ref={captureCanvasRef} className="hidden" />
    </div>
  );
}

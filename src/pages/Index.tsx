import { useRef, useState, useCallback } from "react";
import Icon from "@/components/ui/icon";

type Mode = "idle" | "photo" | "video" | "preview-photo" | "preview-video";

export default function Index() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const [mode, setMode] = useState<Mode>("idle");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const startCamera = useCallback(async (forVideo = false) => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: forVideo,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
    } catch {
      setError("Нет доступа к камере. Разрешите доступ в настройках браузера.");
    }
  }, []);

  const handlePhoto = useCallback(async () => {
    setMode("photo");
    await startCamera(false);
  }, [startCamera]);

  const handleVideo = useCallback(async () => {
    setMode("video");
    await startCamera(true);
  }, [startCamera]);

  const takePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    const url = canvas.toDataURL("image/jpeg", 0.92);
    setPhotoUrl(url);
    stopStream();
    setMode("preview-photo");
  }, [stopStream]);

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
    a.download = `photo_${Date.now()}.jpg`;
    a.click();
  }, [photoUrl]);

  const saveVideo = useCallback(() => {
    if (!videoUrl) return;
    const a = document.createElement("a");
    a.href = videoUrl;
    a.download = `video_${Date.now()}.webm`;
    a.click();
  }, [videoUrl]);

  const reset = useCallback(() => {
    stopStream();
    setMode("idle");
    setPhotoUrl(null);
    setVideoUrl(null);
    setIsRecording(false);
    setError(null);
  }, [stopStream]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-logo">LENS</span>
        {mode !== "idle" && (
          <button className="btn-ghost" onClick={reset}>
            <Icon name="X" size={20} />
          </button>
        )}
      </header>

      <main className="app-main">
        {mode === "idle" && (
          <div className="idle-screen">
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
            {error && <p className="error-msg">{error}</p>}
          </div>
        )}

        {(mode === "photo" || mode === "video") && (
          <div className="camera-screen">
            <div className="viewfinder">
              <video ref={videoRef} className="camera-feed" playsInline muted />
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
            {error && <p className="error-msg">{error}</p>}
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

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}

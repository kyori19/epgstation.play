import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Route =
  | { kind: "home" }
  | {
      kind: "playback";
      recordingId: string;
    };

type RecordingItem = {
  recordingId: string;
  title: string;
  description: string;
  recordedAt: string;
  recordedAtMs: number;
  durationSec: number;
  videoUrl: string | null;
  thumbnailUrl: string | null;
};

type ResumeEntry = {
  positionSec: number;
  durationSec: number;
  watchedRatio: number;
  updatedAt: number;
};

type ResumePayload = {
  resume: ResumeEntry | null;
};

type ResumeBatchPayload = {
  resumes?: Record<string, ResumeEntry | null>;
};

type RecordedResponse = {
  records?: unknown[];
};

export function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));
  const basePath = useMemo(() => getBasePath(window.location.pathname), []);

  useEffect(() => {
    const onPopState = () => {
      setRoute(parseRoute(window.location.pathname));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback(
    (next: Route) => {
      const path = routeToPath(basePath, next);
      if (window.location.pathname !== path) {
        window.history.pushState(null, "", path);
      }
      setRoute(next);
    },
    [basePath],
  );

  if (route.kind === "playback") {
    return (
      <PlaybackPage
        recordingId={route.recordingId}
        onBack={() => {
          navigate({ kind: "home" });
        }}
      />
    );
  }

  return (
    <TopPage
      onOpenRecording={(recordingId) => {
        navigate({ kind: "playback", recordingId });
      }}
    />
  );
}

function TopPage({ onOpenRecording }: { onOpenRecording: (recordingId: string) => void }) {
  const [recentRecordings, setRecentRecordings] = useState<RecordingItem[]>([]);
  const [resumeByRecordingId, setResumeByRecordingId] = useState<Record<string, ResumeEntry | null>>({});
  const [loadingHome, setLoadingHome] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setLoadingHome(true);
      setErrorMessage(null);
      try {
        const recent = await fetchRecentRecordings();
        setRecentRecordings(recent);
        try {
          const resumeMap = await fetchResumeBatch(recent.map((item) => item.recordingId));
          setResumeByRecordingId(resumeMap);
        } catch {
          setResumeByRecordingId({});
        }
      } catch {
        setErrorMessage("一覧の取得に失敗しました。EPGStation API 設定を確認してください。");
      } finally {
        setLoadingHome(false);
      }
    })();
  }, []);

  return (
    <div className="home-layout">
      <header className="home-header">
        <h1>EPGStation Play</h1>
        <p className="note">新規録画一覧から選択して再生ページへ移動します。</p>
      </header>

      {errorMessage && <p className="error">{errorMessage}</p>}

      <div className="top-grid">
        <section className="panel">
          <h2>新規録画</h2>
          {loadingHome ? (
            <p>読み込み中...</p>
          ) : recentRecordings.length === 0 ? (
            <p>録画が見つかりません。</p>
          ) : (
            <ul className="list">
              {recentRecordings.map((recording) => {
                const resumeProgress = getResumeProgress(
                  resumeByRecordingId[recording.recordingId],
                  recording.durationSec,
                );
                return (
                  <li key={recording.recordingId}>
                    <button
                      type="button"
                      className="list-item"
                      onClick={() => onOpenRecording(recording.recordingId)}
                      disabled={!recording.videoUrl}
                    >
                      <div className="list-item-media">
                        <div className="thumbnail-shell">
                          {recording.thumbnailUrl ? (
                            <img
                              className="list-item-thumbnail"
                              src={recording.thumbnailUrl}
                              alt={`${recording.title} のサムネイル`}
                              loading="lazy"
                            />
                          ) : (
                            <div className="list-item-thumbnail placeholder">No Image</div>
                          )}
                          <span className="thumbnail-time">{resumeProgress.timeText}</span>
                          <div className="progress-track thumbnail-progress" aria-hidden="true">
                            <span
                              className="progress-fill"
                              style={{ width: `${Math.round(resumeProgress.ratio * 100)}%` }}
                            />
                          </div>
                        </div>
                      </div>
                      <div className="list-item-content">
                        <span className="title">{recording.title}</span>
                        <span className="meta">{formatDate(recording.recordedAt)}</span>
                        <span className="description-snippet">{toSnippet(recording.description)}</span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function PlaybackPage({ recordingId, onBack }: { recordingId: string; onBack: () => void }) {
  const [recording, setRecording] = useState<RecordingItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setErrorMessage(null);
      setStatusMessage(null);
      try {
        const item = await fetchRecordingDetail(recordingId);
        setRecording(item);
        if (!item.videoUrl) {
          setErrorMessage("動画ファイルが見つからないため再生できません。");
        }
      } catch {
        setRecording(null);
        setErrorMessage("録画情報の取得に失敗しました。");
      } finally {
        setLoading(false);
      }
    })();
  }, [recordingId]);

  return (
    <div className="playback-layout">
      <header className="playback-header">
        <button type="button" onClick={onBack}>
          一覧へ戻る
        </button>
        <div>
          <h2>{recording?.title ?? "再生ページ"}</h2>
          {recording && <p className="note">{formatDate(recording.recordedAt)}</p>}
        </div>
      </header>

      {loading && <p>録画情報を読み込み中...</p>}
      {errorMessage && <p className="error">{errorMessage}</p>}
      {statusMessage && <p className="status">{statusMessage}</p>}

      <section className="playback-player-section">
        <Player episode={recording} onStatus={setStatusMessage} onError={setErrorMessage} />
      </section>
    </div>
  );
}

function Player({
  episode,
  onStatus,
  onError,
}: {
  episode: RecordingItem | null;
  onStatus: (message: string | null) => void;
  onError: (message: string | null) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const resumeReadyRef = useRef(false);

  const saveResume = useCallback(async () => {
    if (!episode?.recordingId) {
      return;
    }
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const durationSec = Number.isFinite(video.duration) ? video.duration : episode.durationSec;
    const positionSec = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    if (durationSec <= 0) {
      return;
    }

    await fetch(`/.play/api/resume/${encodeURIComponent(episode.recordingId)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ positionSec, durationSec }),
    });
  }, [episode]);

  useEffect(() => {
    resumeReadyRef.current = false;
    onStatus(null);
    onError(null);
    if (!episode?.recordingId || !episode.videoUrl) {
      return;
    }

    const video = videoRef.current;
    if (!video) {
      return;
    }

    video.src = episode.videoUrl;
    const loadResume = async () => {
      try {
        const response = await fetch(`/.play/api/resume/${encodeURIComponent(episode.recordingId)}`);
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as ResumePayload;
        const resumePosition = payload.resume?.positionSec ?? 0;
        if (resumePosition > 0) {
          video.currentTime = resumePosition;
          onStatus(`前回の続き ${Math.floor(resumePosition)}秒 から再生します。`);
        }
      } catch {
        onError("前回位置の読み込みに失敗しました。");
      } finally {
        resumeReadyRef.current = true;
      }
    };

    const onLoadedMetadata = () => {
      if (!resumeReadyRef.current) {
        void loadResume();
      }
    };

    video.addEventListener("loadedmetadata", onLoadedMetadata);
    void video.play().catch(() => undefined);
    return () => {
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
    };
  }, [episode, onError, onStatus]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const onPause = () => {
      void saveResume();
    };
    const onEnded = () => {
      void saveResume();
      onStatus("再生完了を保存しました。");
    };
    const onBeforeUnload = () => {
      void saveResume();
    };

    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    window.addEventListener("beforeunload", onBeforeUnload);
    const intervalId = setInterval(() => {
      if (!video.paused) {
        void saveResume();
      }
    }, 300000);

    return () => {
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
      window.removeEventListener("beforeunload", onBeforeUnload);
      clearInterval(intervalId);
    };
  }, [onStatus, saveResume]);

  return <video ref={videoRef} controls preload="metadata" className="player player-large" />;
}

async function fetchRecentRecordings(): Promise<RecordingItem[]> {
  const response = await fetch("/api/recorded?limit=100&isHalfWidth=true");
  if (!response.ok) {
    throw new Error(`recorded API failed: ${response.status}`);
  }
  const payload = (await response.json()) as RecordedResponse;
  return (payload.records ?? [])
    .map((item) => normalizeRecording(item))
    .filter((item): item is RecordingItem => item !== null)
    .sort((a, b) => b.recordedAtMs - a.recordedAtMs);
}

async function fetchRecordingDetail(recordingId: string): Promise<RecordingItem> {
  const response = await fetch(`/api/recorded/${encodeURIComponent(recordingId)}?isHalfWidth=true`);
  if (!response.ok) {
    throw new Error(`recording detail API failed: ${response.status}`);
  }
  const payload = (await response.json()) as unknown;
  const normalized = normalizeRecording(payload);
  if (!normalized) {
    throw new Error("recording payload is invalid");
  }
  return normalized;
}

async function fetchResumeBatch(recordingIds: string[]): Promise<Record<string, ResumeEntry | null>> {
  if (recordingIds.length === 0) {
    return {};
  }
  const query = new URLSearchParams();
  for (const recordingId of recordingIds) {
    query.append("recordingId", recordingId);
  }

  const response = await fetch(`/.play/api/resume?${query.toString()}`);
  if (!response.ok) {
    throw new Error(`resume API failed: ${response.status}`);
  }
  const payload = (await response.json()) as ResumeBatchPayload;
  return isRecord(payload.resumes) ? payload.resumes : {};
}

function normalizeRecording(value: unknown): RecordingItem | null {
  if (!isRecord(value)) {
    return null;
  }
  const recordingId = toStringSafe(value.id);
  const title = toStringSafe(value.name) ?? "無題";
  const description = toStringSafe(value.description) ?? "";
  const startAt = toNumber(value.startAt);
  const endAt = toNumber(value.endAt);
  if (!recordingId || startAt === null) {
    return null;
  }

  const videoFiles = Array.isArray(value.videoFiles) ? value.videoFiles : [];
  const preferredVideo =
    videoFiles.find(
      (item) =>
        isRecord(item) &&
        toNumber(item.id) !== null &&
        typeof item.type === "string" &&
        item.type.toLowerCase() === "encoded",
    ) ?? videoFiles.find((item) => isRecord(item) && toNumber(item.id) !== null);
  const videoFileId = preferredVideo && isRecord(preferredVideo) ? toNumber(preferredVideo.id) : null;
  const videoUrl = videoFileId !== null ? `/api/videos/${videoFileId}` : null;
  const thumbnails = Array.isArray(value.thumbnails) ? value.thumbnails : [];
  const thumbnailId = thumbnails.map((item) => toNumber(item)).find((item): item is number => item !== null) ?? null;
  const thumbnailUrl = thumbnailId !== null ? `/api/thumbnails/${thumbnailId}` : null;

  const durationSec = endAt !== null && endAt >= startAt ? (endAt - startAt) / 1000 : 0;
  return {
    recordingId,
    title,
    description,
    recordedAt: new Date(startAt).toISOString(),
    recordedAtMs: startAt,
    durationSec,
    videoUrl,
    thumbnailUrl,
  };
}

function parseRoute(pathname: string): Route {
  const match = pathname.match(/\/play\/([^/]+)\/?$/);
  if (match) {
    return { kind: "playback", recordingId: decodeURIComponent(match[1]) };
  }
  return { kind: "home" };
}

function getBasePath(pathname: string): string {
  return pathname.startsWith("/.play") ? "/.play" : "";
}

function routeToPath(basePath: string, route: Route): string {
  const normalizedBase = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
  if (route.kind === "playback") {
    return `${normalizedBase}/play/${encodeURIComponent(route.recordingId)}`;
  }
  return normalizedBase ? `${normalizedBase}/` : "/";
}

function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleString("ja-JP");
}

function getResumeProgress(
  resume: ResumeEntry | null | undefined,
  fallbackDurationSec: number,
): { ratio: number; timeText: string } {
  const durationSec = resume && resume.durationSec > 0 ? resume.durationSec : Math.max(0, fallbackDurationSec);
  const positionSec = Math.max(0, resume?.positionSec ?? 0);
  const timeText = durationSec > 0 ? `${formatTime(Math.floor(positionSec))} / ${formatTime(Math.floor(durationSec))}` : "0:00";
  if (!resume) {
    return { ratio: 0, timeText };
  }
  const watched = resume.watchedRatio >= 0.95 || positionSec >= Math.max(durationSec - 5, 0);
  if (watched) {
    return {
      ratio: 1,
      timeText: durationSec > 0 ? `${formatTime(Math.floor(durationSec))} / ${formatTime(Math.floor(durationSec))}` : timeText,
    };
  }
  const ratio = durationSec > 0 ? clampNumber(positionSec / durationSec, 0, 1) : 0;
  return { ratio, timeText };
}

function toSnippet(description: string): string {
  if (description.trim().length === 0) {
    return "説明なし";
  }
  const compact = description.replace(/\s+/g, " ").trim();
  return compact.length > 90 ? `${compact.slice(0, 90)}…` : compact;
}

function formatTime(totalSec: number): string {
  const safeSec = Math.max(0, totalSec);
  const hour = Math.floor(safeSec / 3600);
  const minute = Math.floor((safeSec % 3600) / 60);
  const second = safeSec % 60;
  if (hour > 0) {
    return `${hour}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
  }
  return `${minute}:${String(second).padStart(2, "0")}`;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toStringSafe(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

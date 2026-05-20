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
  ruleId: number | null;
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

type RuleResponse = {
  searchOption?: {
    keyword?: unknown;
  };
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
        onOpenRecording={(nextRecordingId) => {
          navigate({ kind: "playback", recordingId: nextRecordingId });
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
                return (
                  <li key={recording.recordingId}>
                    <RecordingListItem
                      recording={recording}
                      onOpenRecording={onOpenRecording}
                      resume={resumeByRecordingId[recording.recordingId]}
                    />
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

function PlaybackPage({
  recordingId,
  onBack,
  onOpenRecording,
}: {
  recordingId: string;
  onBack: () => void;
  onOpenRecording: (recordingId: string) => void;
}) {
  const [recording, setRecording] = useState<RecordingItem | null>(null);
  const [playlist, setPlaylist] = useState<RecordingItem[]>([]);
  const [playlistResumeByRecordingId, setPlaylistResumeByRecordingId] = useState<
    Record<string, ResumeEntry | null>
  >({});
  const [ruleLabel, setRuleLabel] = useState<string | null>(null);
  const [loadingPlaylist, setLoadingPlaylist] = useState(false);
  const [playlistErrorMessage, setPlaylistErrorMessage] = useState<string | null>(null);
  const [continuousPlayEnabled, setContinuousPlayEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const initialTitleRef = useRef<string | null>(null);

  useEffect(() => {
    if (initialTitleRef.current === null) {
      initialTitleRef.current = document.title;
    }
    return () => {
      if (initialTitleRef.current !== null) {
        document.title = initialTitleRef.current;
      }
    };
  }, []);

  useEffect(() => {
    document.title = recording?.title ? recording.title : "EPGStation Play";
  }, [recording?.title]);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setPlaylist([]);
      setPlaylistResumeByRecordingId({});
      setRuleLabel(null);
      setLoadingPlaylist(false);
      setPlaylistErrorMessage(null);
      setErrorMessage(null);
      setStatusMessage(null);
      try {
        const item = await fetchRecordingDetail(recordingId);
        setRecording(item);
        if (item.ruleId !== null) {
          setLoadingPlaylist(true);
          try {
            const [playlistItems, fetchedRuleLabel] = await Promise.all([
              fetchRuleRecordings(item.ruleId),
              fetchRuleLabel(item.ruleId),
            ]);
            const mergedPlaylist = mergeRecordingIntoPlaylist(item, playlistItems);
            setPlaylist(mergedPlaylist);
            setRuleLabel(fetchedRuleLabel);
          } catch {
            setPlaylist([]);
            setPlaylistErrorMessage("録画ルールの再生リスト取得に失敗しました。");
          } finally {
            setLoadingPlaylist(false);
          }
        }
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

  useEffect(() => {
    if (playlist.length === 0) {
      setPlaylistResumeByRecordingId({});
      return;
    }

    let canceled = false;
    void (async () => {
      try {
        const resumeMap = await fetchResumeBatch(playlist.map((item) => item.recordingId));
        if (!canceled) {
          setPlaylistResumeByRecordingId(resumeMap);
        }
      } catch {
        if (!canceled) {
          setPlaylistResumeByRecordingId({});
        }
      }
    })();

    return () => {
      canceled = true;
    };
  }, [playlist]);

  const nextRecording = useMemo(() => {
    if (!recording || playlist.length === 0) {
      return null;
    }
    const sorted = [...playlist].sort((a, b) => a.recordedAtMs - b.recordedAtMs);
    const currentIndex = sorted.findIndex((item) => item.recordingId === recording.recordingId);
    if (currentIndex < 0 || currentIndex >= sorted.length - 1) {
      return null;
    }
    return sorted[currentIndex + 1];
  }, [playlist, recording]);

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
      {playlistErrorMessage && <p className="error">{playlistErrorMessage}</p>}

      <section className="playback-player-section">
        <Player
          episode={recording}
          onStatus={setStatusMessage}
          onError={setErrorMessage}
          onEpisodeEnded={() => {
            if (
              continuousPlayEnabled &&
              nextRecording &&
              recording?.ruleId !== null &&
              nextRecording.videoUrl
            ) {
              setStatusMessage(`次の録画へ移動します: ${nextRecording.title}`);
              onOpenRecording(nextRecording.recordingId);
              return true;
            }
            return false;
          }}
        />
      </section>
      {recording && recording.ruleId !== null && (
        <section className="panel playback-playlist-section">
          <div className="playback-playlist-header">
            <div>
              <h3>録画ルール再生リスト</h3>
              <p className="note">{ruleLabel ?? `ルールID: ${recording.ruleId}`}</p>
            </div>
            <label className="toggle-line">
              <input
                type="checkbox"
                checked={continuousPlayEnabled}
                onChange={(event) => setContinuousPlayEnabled(event.currentTarget.checked)}
              />
              連続再生
            </label>
          </div>
          {loadingPlaylist ? (
            <p>再生リストを読み込み中...</p>
          ) : playlist.length === 0 ? (
            <p>ルール内の録画が見つかりません。</p>
          ) : (
            <>
              <p className="note">
                次に再生:{" "}
                {nextRecording?.title && nextRecording.videoUrl ? nextRecording.title : "次の録画はありません"}
              </p>
                <ul className="list">
                  {playlist
                    .slice()
                    .sort((a, b) => a.recordedAtMs - b.recordedAtMs)
                    .map((item) => (
                      <li key={item.recordingId}>
                        <RecordingListItem
                          recording={item}
                          onOpenRecording={onOpenRecording}
                          isActive={item.recordingId === recording.recordingId}
                          resume={playlistResumeByRecordingId[item.recordingId]}
                        />
                      </li>
                    ))}
                </ul>
            </>
          )}
        </section>
      )}
    </div>
  );
}

function RecordingListItem({
  recording,
  onOpenRecording,
  isActive = false,
  resume,
}: {
  recording: RecordingItem;
  onOpenRecording: (recordingId: string) => void;
  isActive?: boolean;
  resume?: ResumeEntry | null;
}) {
  const resumeProgress = getResumeProgress(resume, recording.durationSec);
  return (
    <button
      type="button"
      className={`list-item${isActive ? " active" : ""}`}
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
            <span className="progress-fill" style={{ width: `${Math.round(resumeProgress.ratio * 100)}%` }} />
          </div>
        </div>
      </div>
      <div className="list-item-content">
        <span className="title">{recording.title}</span>
        <span className="meta">{formatDateWithWeekday(recording.recordedAt)}</span>
        <span className="description-snippet">{toSnippet(recording.description)}</span>
      </div>
    </button>
  );
}

function Player({
  episode,
  onStatus,
  onError,
  onEpisodeEnded,
}: {
  episode: RecordingItem | null;
  onStatus: (message: string | null) => void;
  onError: (message: string | null) => void;
  onEpisodeEnded: () => boolean;
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
      if (!onEpisodeEnded()) {
        onStatus("再生完了を保存しました。");
      }
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
  }, [onEpisodeEnded, onStatus, saveResume]);

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

async function fetchRuleRecordings(ruleId: number): Promise<RecordingItem[]> {
  const response = await fetch(`/api/recorded?ruleId=${encodeURIComponent(String(ruleId))}&limit=100&isHalfWidth=true`);
  if (!response.ok) {
    throw new Error(`recorded by rule API failed: ${response.status}`);
  }
  const payload = (await response.json()) as RecordedResponse;
  return (payload.records ?? [])
    .map((item) => normalizeRecording(item))
    .filter((item): item is RecordingItem => item !== null)
    .sort((a, b) => a.recordedAtMs - b.recordedAtMs);
}

async function fetchRuleLabel(ruleId: number): Promise<string | null> {
  const response = await fetch(`/api/rules/${encodeURIComponent(String(ruleId))}`);
  if (!response.ok) {
    return `ルールID: ${ruleId}`;
  }
  const payload = (await response.json()) as RuleResponse;
  const keyword = toStringSafe(payload.searchOption?.keyword);
  return keyword ? `キーワード: ${keyword}` : `ルールID: ${ruleId}`;
}

function mergeRecordingIntoPlaylist(current: RecordingItem, playlist: RecordingItem[]): RecordingItem[] {
  const byId = new Map<string, RecordingItem>();
  for (const item of playlist) {
    byId.set(item.recordingId, item);
  }
  byId.set(current.recordingId, current);
  return [...byId.values()].sort((a, b) => a.recordedAtMs - b.recordedAtMs);
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
  const ruleId = toNumber(value.ruleId);
  return {
    recordingId,
    title,
    description,
    recordedAt: new Date(startAt).toISOString(),
    recordedAtMs: startAt,
    durationSec,
    videoUrl,
    thumbnailUrl,
    ruleId,
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

function formatDateWithWeekday(isoDate: string): string {
  const date = new Date(isoDate);
  const weekday = date.toLocaleDateString("ja-JP", { weekday: "short" });
  const dateText = date.toLocaleDateString("ja-JP");
  const timeText = date.toLocaleTimeString("ja-JP");
  return `${dateText}（${weekday}） ${timeText}`;
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

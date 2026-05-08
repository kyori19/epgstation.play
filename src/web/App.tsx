import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Route =
  | { kind: "home" }
  | {
      kind: "playback";
      recordingId: string;
    };

type Rule = {
  id: string;
  name: string;
};

type RecordingItem = {
  recordingId: string;
  ruleId: string | null;
  title: string;
  recordedAt: string;
  recordedAtMs: number;
  durationSec: number;
  videoUrl: string | null;
};

type ResumePayload = {
  resume: {
    positionSec: number;
    durationSec: number;
    watchedRatio: number;
    updatedAt: number;
  } | null;
};

type RecordedResponse = {
  records?: unknown[];
};

type RulesResponse = {
  rules?: unknown[];
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
  const [rules, setRules] = useState<Rule[]>([]);
  const [activeRuleId, setActiveRuleId] = useState<string | null>(null);
  const [episodes, setEpisodes] = useState<RecordingItem[]>([]);
  const [activeTab, setActiveTab] = useState<"recent" | "rules">("recent");
  const [loadingHome, setLoadingHome] = useState(true);
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setLoadingHome(true);
      setErrorMessage(null);
      try {
        const [recent, fetchedRules] = await Promise.all([fetchRecentRecordings(), fetchRules()]);
        setRecentRecordings(recent);
        setRules(sortRulesByRecentRecordings(fetchedRules, recent));
      } catch {
        setErrorMessage("一覧の取得に失敗しました。EPGStation API 設定を確認してください。");
      } finally {
        setLoadingHome(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (rules.length === 0) {
      setActiveRuleId(null);
      return;
    }
    setActiveRuleId((current) => {
      if (current && rules.some((rule) => rule.id === current)) {
        return current;
      }
      return rules[0].id;
    });
  }, [rules]);

  useEffect(() => {
    if (!activeRuleId) {
      setEpisodes([]);
      return;
    }
    void (async () => {
      setLoadingEpisodes(true);
      setErrorMessage(null);
      try {
        const nextEpisodes = await fetchRecordingsByRuleId(activeRuleId);
        setEpisodes(nextEpisodes);
      } catch {
        setErrorMessage("ルールの録画一覧取得に失敗しました。");
        setEpisodes([]);
      } finally {
        setLoadingEpisodes(false);
      }
    })();
  }, [activeRuleId]);

  return (
    <div className="home-layout">
      <header className="home-header">
        <h1>EPGStation Play</h1>
        <p className="note">録画一覧とルール一覧から選択して再生ページへ移動します。</p>
      </header>

      <div className="tabs" role="tablist" aria-label="一覧切り替え">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "recent"}
          className={activeTab === "recent" ? "active" : ""}
          onClick={() => setActiveTab("recent")}
        >
          新規録画
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "rules"}
          className={activeTab === "rules" ? "active" : ""}
          onClick={() => setActiveTab("rules")}
        >
          ルール
        </button>
      </div>

      {errorMessage && <p className="error">{errorMessage}</p>}

      <div className="top-grid">
        <section className={activeTab === "recent" ? "panel panel-visible" : "panel panel-hidden-mobile"}>
          <h2>新規録画</h2>
          {loadingHome ? (
            <p>読み込み中...</p>
          ) : recentRecordings.length === 0 ? (
            <p>録画が見つかりません。</p>
          ) : (
            <ul className="list">
              {recentRecordings.map((recording) => (
                <li key={recording.recordingId}>
                  <button
                    type="button"
                    className="list-item"
                    onClick={() => onOpenRecording(recording.recordingId)}
                    disabled={!recording.videoUrl}
                  >
                    <span className="title">{recording.title}</span>
                    <span className="meta">{formatDate(recording.recordedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={activeTab === "rules" ? "panel panel-visible" : "panel panel-hidden-mobile"}>
          <h2>ルール</h2>
          {loadingHome ? (
            <p>読み込み中...</p>
          ) : rules.length === 0 ? (
            <p>ルールが見つかりません。</p>
          ) : (
            <ul className="list">
              {rules.map((rule) => (
                <li key={rule.id}>
                  <button
                    type="button"
                    className={rule.id === activeRuleId ? "active" : ""}
                    onClick={() => setActiveRuleId(rule.id)}
                  >
                    {rule.name}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <h3>選択ルールの録画</h3>
          {loadingEpisodes ? (
            <p>読み込み中...</p>
          ) : episodes.length === 0 ? (
            <p>対象録画はありません。</p>
          ) : (
            <ul className="list">
              {episodes.map((episode) => (
                <li key={episode.recordingId}>
                  <button
                    type="button"
                    className="list-item"
                    onClick={() => onOpenRecording(episode.recordingId)}
                    disabled={!episode.videoUrl}
                  >
                    <span className="title">{episode.title}</span>
                    <span className="meta">{formatDate(episode.recordedAt)}</span>
                  </button>
                </li>
              ))}
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
    }, 10000);

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

async function fetchRules(): Promise<Rule[]> {
  const response = await fetch("/api/rules?limit=100");
  if (!response.ok) {
    throw new Error(`rules API failed: ${response.status}`);
  }
  const payload = (await response.json()) as RulesResponse;
  return (payload.rules ?? [])
    .map((item) => normalizeRule(item))
    .filter((item): item is Rule => item !== null);
}

async function fetchRecordingsByRuleId(ruleId: string): Promise<RecordingItem[]> {
  const response = await fetch(`/api/recorded?ruleId=${encodeURIComponent(ruleId)}&isHalfWidth=true&limit=100`);
  if (!response.ok) {
    throw new Error(`recorded by rule API failed: ${response.status}`);
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

function normalizeRecording(value: unknown): RecordingItem | null {
  if (!isRecord(value)) {
    return null;
  }
  const recordingId = toStringSafe(value.id);
  const title = toStringSafe(value.name) ?? "無題";
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

  const durationSec = endAt !== null && endAt >= startAt ? (endAt - startAt) / 1000 : 0;
  return {
    recordingId,
    ruleId: toStringSafe(value.ruleId),
    title,
    recordedAt: new Date(startAt).toISOString(),
    recordedAtMs: startAt,
    durationSec,
    videoUrl,
  };
}

function normalizeRule(value: unknown): Rule | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = toStringSafe(value.id);
  if (!id) {
    return null;
  }
  const searchOption = isRecord(value.searchOption) ? value.searchOption : null;
  const name =
    toStringSafe(value.name) ??
    (searchOption ? toStringSafe(searchOption.keyword) : null) ??
    `Rule ${id}`;
  return { id, name };
}

function sortRulesByRecentRecordings(rules: Rule[], recentRecordings: RecordingItem[]): Rule[] {
  const latestByRuleId = new Map<string, number>();
  for (const recording of recentRecordings) {
    if (!recording.ruleId) {
      continue;
    }
    const current = latestByRuleId.get(recording.ruleId) ?? 0;
    if (recording.recordedAtMs > current) {
      latestByRuleId.set(recording.ruleId, recording.recordedAtMs);
    }
  }

  return [...rules].sort((a, b) => {
    const aLatest = latestByRuleId.get(a.id) ?? 0;
    const bLatest = latestByRuleId.get(b.id) ?? 0;
    if (aLatest !== bLatest) {
      return bLatest - aLatest;
    }
    return a.name.localeCompare(b.name, "ja");
  });
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

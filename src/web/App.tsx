import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Rule = {
  id: string;
  name: string;
};

type Episode = {
  recordingId: string | null;
  ruleId: string;
  title: string;
  recordedAt: string;
  durationSec: number;
  videoUrl: string | null;
  watchedRatio: number;
};

type ResumePayload = {
  resume: {
    positionSec: number;
    durationSec: number;
    watchedRatio: number;
    updatedAt: number;
  } | null;
};

export function App() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [activeRuleId, setActiveRuleId] = useState<string | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [activeEpisode, setActiveEpisode] = useState<Episode | null>(null);
  const [loadingRules, setLoadingRules] = useState(true);
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setLoadingRules(true);
      setErrorMessage(null);
      try {
        const response = await fetch("/.play/api/rules");
        if (!response.ok) {
          throw new Error(`rules API failed: ${response.status}`);
        }

        const payload = (await response.json()) as { rules: Rule[] };
        setRules(payload.rules ?? []);
        setActiveRuleId((current) => current ?? payload.rules?.[0]?.id ?? null);
      } catch {
        setErrorMessage("ルール一覧の取得に失敗しました。EPGStation API設定を確認してください。");
      } finally {
        setLoadingRules(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!activeRuleId) {
      setEpisodes([]);
      setActiveEpisode(null);
      return;
    }

    void (async () => {
      setLoadingEpisodes(true);
      setStatusMessage(null);
      setErrorMessage(null);
      try {
        const response = await fetch(`/.play/api/rules/${encodeURIComponent(activeRuleId)}/episodes`);
        if (!response.ok) {
          throw new Error(`episodes API failed: ${response.status}`);
        }
        const payload = (await response.json()) as { episodes: Episode[] };
        setEpisodes(payload.episodes ?? []);

        const next = (payload.episodes ?? []).find(
          (episode) => episode.recordingId !== null && episode.watchedRatio < 0.9,
        );
        setActiveEpisode(next ?? payload.episodes?.[0] ?? null);
      } catch {
        setErrorMessage("エピソード一覧の取得に失敗しました。");
        setEpisodes([]);
        setActiveEpisode(null);
      } finally {
        setLoadingEpisodes(false);
      }
    })();
  }, [activeRuleId]);

  const activeRule = useMemo(
    () => rules.find((rule) => rule.id === activeRuleId) ?? null,
    [activeRuleId, rules],
  );

  const chooseNextUnwatched = useCallback(async () => {
    if (!activeRuleId) {
      return;
    }

    setStatusMessage(null);
    try {
      const response = await fetch(`/.play/api/rules/${encodeURIComponent(activeRuleId)}/next`);
      if (!response.ok) {
        throw new Error(`next API failed: ${response.status}`);
      }
      const payload = (await response.json()) as { nextEpisode: Episode | null };
      if (!payload.nextEpisode) {
        setStatusMessage("このルールに未視聴話はありません。");
        return;
      }
      setActiveEpisode(payload.nextEpisode);
    } catch {
      setErrorMessage("次話の取得に失敗しました。");
    }
  }, [activeRuleId]);

  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>EPGStation Play</h1>
        <p className="note">ruleごとに未視聴話（90%未満）から再生できます。</p>
        {loadingRules ? (
          <p>ルールを読み込み中...</p>
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
      </aside>
      <main className="content">
        <header className="toolbar">
          <h2>{activeRule?.name ?? "ルール未選択"}</h2>
          <button type="button" onClick={() => void chooseNextUnwatched()} disabled={!activeRuleId}>
            未視聴の次話へ
          </button>
        </header>

        {errorMessage && <p className="error">{errorMessage}</p>}
        {statusMessage && <p className="status">{statusMessage}</p>}

        <section>
          <h3>エピソード</h3>
          {loadingEpisodes ? (
            <p>エピソードを読み込み中...</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>タイトル</th>
                  <th>録画日時</th>
                  <th>視聴率</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {episodes.map((episode) => (
                  <tr
                    key={`${episode.ruleId}-${episode.recordingId ?? episode.title}`}
                    className={activeEpisode?.recordingId === episode.recordingId ? "row-active" : ""}
                  >
                    <td>
                      {episode.title}
                      {!episode.recordingId && <span className="badge">録画IDなし</span>}
                    </td>
                    <td>{new Date(episode.recordedAt).toLocaleString("ja-JP")}</td>
                    <td>{Math.round(episode.watchedRatio * 100)}%</td>
                    <td>
                      <button
                        type="button"
                        onClick={() => setActiveEpisode(episode)}
                        disabled={!episode.recordingId || !episode.videoUrl}
                      >
                        再生
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section>
          <h3>プレイヤー</h3>
          <Player episode={activeEpisode} onStatus={setStatusMessage} onError={setErrorMessage} />
        </section>
      </main>
    </div>
  );
}

function Player({
  episode,
  onStatus,
  onError,
}: {
  episode: Episode | null;
  onStatus: (message: string | null) => void;
  onError: (message: string | null) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const resumeReadyRef = useRef(false);

  const saveResume = useCallback(async () => {
    if (!episode?.recordingId) {
      onError("録画IDがないため再生できません。");
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
  }, [episode, onError]);

  useEffect(() => {
    resumeReadyRef.current = false;
    onStatus(null);
    onError(null);
    if (!episode?.recordingId) {
      if (episode) {
        onError("録画IDがないため、このエピソードは再生できません。");
      }
      return;
    }

    const video = videoRef.current;
    if (!video || !episode.videoUrl) {
      return;
    }

    video.src = episode.videoUrl;
    const loadResume = async () => {
      try {
        const response = await fetch(`/.play/api/resume/${encodeURIComponent(episode.recordingId!)}`);
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

    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    const intervalId = setInterval(() => {
      if (!video.paused) {
        void saveResume();
      }
    }, 10000);

    const onBeforeUnload = () => {
      void saveResume();
    };
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
      window.removeEventListener("beforeunload", onBeforeUnload);
      clearInterval(intervalId);
    };
  }, [onStatus, saveResume]);

  return <video ref={videoRef} controls preload="metadata" className="player" />;
}

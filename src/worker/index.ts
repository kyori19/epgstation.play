import type { ResumeRow } from "./types";

type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
};

const PLAY_PREFIX = "/.play";
const API_PREFIX = `${PLAY_PREFIX}/api`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === PLAY_PREFIX) {
      return Response.redirect(`${url.origin}${PLAY_PREFIX}/`, 302);
    }

    if (url.pathname.startsWith(API_PREFIX)) {
      return handleApi(request, env, url);
    }

    if (url.pathname.startsWith(`${PLAY_PREFIX}/`)) {
      return serveSpaAsset(request, env, url);
    }

    return new Response("Not Found", { status: 404 });
  },
};

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  const method = request.method.toUpperCase();
  const pathname = url.pathname;

  const resumeMatch = pathname.match(/^\/\.play\/api\/resume\/([^/]+)$/);
  if (resumeMatch) {
    const recordingId = decodeURIComponent(resumeMatch[1]);

    if (method === "GET") {
      const resume = await env.DB.prepare(
        "SELECT recording_id, position_sec, duration_sec, watched_ratio, updated_at FROM resume_positions WHERE recording_id = ?",
      )
        .bind(recordingId)
        .first<ResumeRow>();
      return jsonResponse({
        recordingId,
        resume:
          resume === null
            ? null
            : {
                positionSec: resume.position_sec,
                durationSec: resume.duration_sec,
                watchedRatio: resume.watched_ratio,
                updatedAt: resume.updated_at,
              },
      });
    }

    if (method === "PUT") {
      const payload = await parseJson(request);
      const positionSec = toNumber(payload?.positionSec);
      const durationSec = toNumber(payload?.durationSec);
      if (positionSec === null || durationSec === null || durationSec < 0 || positionSec < 0) {
        return jsonResponse(
          { error: "positionSec と durationSec は 0 以上の数値が必要です" },
          400,
        );
      }

      const safePosition = durationSec > 0 ? Math.min(positionSec, durationSec) : positionSec;
      const watchedRatio = durationSec > 0 ? clamp(safePosition / durationSec, 0, 1) : 0;
      const updatedAt = Date.now();

      await env.DB.prepare(
        `INSERT INTO resume_positions (recording_id, position_sec, duration_sec, watched_ratio, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(recording_id) DO UPDATE SET
           position_sec = excluded.position_sec,
           duration_sec = excluded.duration_sec,
           watched_ratio = excluded.watched_ratio,
           updated_at = excluded.updated_at`,
      )
        .bind(recordingId, safePosition, durationSec, watchedRatio, updatedAt)
        .run();

      return jsonResponse({
        recordingId,
        resume: {
          positionSec: safePosition,
          durationSec,
          watchedRatio,
          updatedAt,
        },
      });
    }
  }

  return jsonResponse({ error: "Not Found" }, 404);
}

async function serveSpaAsset(request: Request, env: Env, url: URL): Promise<Response> {
  const normalizedPath = url.pathname.replace(/^\/\.play/, "") || "/";
  const rewritten = new URL(url.toString());
  rewritten.pathname = normalizedPath;

  const assetResponse = await env.ASSETS.fetch(new Request(rewritten.toString(), request));
  if (assetResponse.status !== 404) {
    return assetResponse;
  }

  rewritten.pathname = "/index.html";
  return env.ASSETS.fetch(new Request(rewritten.toString(), request));
}

async function parseJson(request: Request): Promise<Record<string, unknown> | null> {
  const contentType = request.headers.get("content-type");
  if (!contentType || !contentType.includes("application/json")) {
    return null;
  }

  try {
    const payload = (await request.json()) as unknown;
    if (typeof payload !== "object" || payload === null) {
      return null;
    }
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

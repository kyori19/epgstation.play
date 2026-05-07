import type { Episode, Rule } from "./types";

type UnknownRecord = Record<string, unknown>;

export class EpgStationAdapter {
  constructor(
    private readonly request: Request,
    private readonly apiBase: string,
  ) {}

  async fetchRules(): Promise<Rule[]> {
    const explicitRules = await this.tryFetchRulesEndpoint();
    if (explicitRules.length > 0) {
      return explicitRules;
    }

    const recordedItems = await this.tryFetchRecorded();
    const grouped = new Map<string, Rule>();

    for (const item of recordedItems) {
      const ruleId = this.getString(item.ruleId) ?? this.getString(this.getNested(item, "rule", "id"));
      if (!ruleId) {
        continue;
      }

      const nameCandidate =
        this.getString(item.ruleName) ??
        this.getString(this.getNested(item, "rule", "name")) ??
        this.getString(this.getNested(item, "program", "name")) ??
        `Rule ${ruleId}`;
      grouped.set(ruleId, { id: ruleId, name: nameCandidate });
    }

    return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name, "ja"));
  }

  async fetchEpisodesByRule(ruleId: string): Promise<Episode[]> {
    const encoded = encodeURIComponent(ruleId);
    const payload = await this.fetchJsonFromCandidates([
      `/recorded?ruleId=${encoded}`,
      `/recorded?isHalfWidth=false&ruleId=${encoded}`,
      `/recorded?rule=${encoded}`,
    ]);

    const records = this.pickArray(payload);
    const episodes: Episode[] = records
      .map((entry) => this.normalizeEpisode(entry, ruleId))
      .filter((episode): episode is Episode => episode !== null)
      .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));

    return episodes;
  }

  private async tryFetchRulesEndpoint(): Promise<Rule[]> {
    const payload = await this.fetchJsonFromCandidates(
      ["/rules", "/rule", "/rules?isHalfWidth=false"],
      true,
    );
    if (!payload) {
      return [];
    }

    const records = this.pickArray(payload);
    return records
      .map((entry) => {
        const id =
          this.getString(entry.id) ??
          this.getString(entry.ruleId) ??
          this.getString(this.getNested(entry, "rule", "id"));
        if (!id) {
          return null;
        }

        const name =
          this.getString(entry.name) ??
          this.getString(entry.ruleName) ??
          this.getString(this.getNested(entry, "program", "name")) ??
          `Rule ${id}`;
        return { id, name };
      })
      .filter((rule): rule is Rule => rule !== null)
      .sort((a, b) => a.name.localeCompare(b.name, "ja"));
  }

  private async tryFetchRecorded(): Promise<UnknownRecord[]> {
    const payload = await this.fetchJsonFromCandidates(
      ["/recorded", "/recorded?isHalfWidth=false"],
      true,
    );
    if (!payload) {
      return [];
    }
    return this.pickArray(payload);
  }

  private normalizeEpisode(entry: UnknownRecord, fallbackRuleId: string): Episode | null {
    const recordingId = this.getString(entry.id) ?? this.getString(entry.recordingId) ?? null;
    const ruleId =
      this.getString(entry.ruleId) ??
      this.getString(this.getNested(entry, "rule", "id")) ??
      fallbackRuleId;
    const title =
      this.getString(entry.name) ??
      this.getString(entry.title) ??
      this.getString(this.getNested(entry, "program", "name")) ??
      `録画 ${recordingId ?? "unknown"}`;

    const recordedAtRaw =
      this.getNumber(entry.startAt) ??
      this.getNumber(entry.start_at) ??
      this.getNumber(entry.recordedAt) ??
      this.getNumber(entry.recorded_at) ??
      Date.now();

    const durationMs =
      this.getNumber(this.getNested(entry, "videoFiles", 0, "duration")) ??
      this.getNumber(this.getNested(entry, "program", "duration")) ??
      0;
    const durationSec = durationMs > 1000 ? durationMs / 1000 : durationMs;

    const explicitVideoUrl = this.getString(entry.videoUrl) ?? this.getString(entry.url);
    const videoUrl =
      explicitVideoUrl ??
      (recordingId ? `/api/recorded/${encodeURIComponent(recordingId)}/file` : null);

    return {
      recordingId,
      ruleId,
      title,
      recordedAt: new Date(recordedAtRaw).toISOString(),
      durationSec,
      videoUrl,
    };
  }

  private async fetchJsonFromCandidates(
    candidatePaths: string[],
    allowFailure = false,
  ): Promise<unknown | null> {
    for (const candidate of candidatePaths) {
      const response = await this.fetchApi(candidate);
      if (!response || !response.ok) {
        continue;
      }

      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        continue;
      }

      return response.json();
    }

    if (allowFailure) {
      return null;
    }

    throw new Error(`Failed to fetch EPGStation API: ${candidatePaths.join(", ")}`);
  }

  private async fetchApi(pathname: string): Promise<Response | null> {
    const url = new URL(this.request.url);
    const base = this.apiBase.startsWith("http")
      ? new URL(this.apiBase)
      : new URL(this.apiBase, url.origin);
    const resolved = new URL(pathname, `${base.toString().replace(/\/$/, "")}/`);

    try {
      return await fetch(resolved.toString(), {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });
    } catch {
      return null;
    }
  }

  private pickArray(payload: unknown): UnknownRecord[] {
    if (Array.isArray(payload)) {
      return payload.filter((v): v is UnknownRecord => this.isRecord(v));
    }

    if (!this.isRecord(payload)) {
      return [];
    }

    const candidates = [payload.items, payload.records, payload.recorded, payload.rules, payload.data];
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        return candidate.filter((v): v is UnknownRecord => this.isRecord(v));
      }
    }

    return [];
  }

  private isRecord(value: unknown): value is UnknownRecord {
    return typeof value === "object" && value !== null;
  }

  private getNested(value: unknown, ...keys: Array<string | number>): unknown {
    let current: unknown = value;
    for (const key of keys) {
      if (typeof key === "number") {
        if (!Array.isArray(current) || key < 0 || key >= current.length) {
          return undefined;
        }
        current = current[key];
        continue;
      }

      if (!this.isRecord(current) || !(key in current)) {
        return undefined;
      }
      current = current[key];
    }
    return current;
  }

  private getString(value: unknown): string | null {
    if (typeof value === "string" && value.length > 0) {
      return value;
    }

    if (typeof value === "number") {
      return String(value);
    }

    return null;
  }

  private getNumber(value: unknown): number | null {
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
}

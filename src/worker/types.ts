export type Rule = {
  id: string;
  name: string;
};

export type Episode = {
  recordingId: string | null;
  ruleId: string;
  title: string;
  recordedAt: string;
  durationSec: number;
  videoUrl: string | null;
};

export type ResumeRow = {
  recording_id: string;
  position_sec: number;
  duration_sec: number;
  watched_ratio: number;
  updated_at: number;
};

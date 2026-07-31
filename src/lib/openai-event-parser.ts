import { Pillar } from "@/types/task";

export interface ParsedEvent {
  title: string;
  startTime: string;
  endTime: string;
  calendarId?: string | null;
  description?: string;
  isImportant?: boolean;
  isAllDay?: boolean;
  pillar?: Pillar;
  category?: "operational" | "strategic";
  isDelegable?: boolean;
  recurrenceType?: "daily" | "weekdays" | "weekly" | "biweekly" | "monthly" | "yearly";
  attendees?: string[];
}

export async function transcribeAudio(audioBuffer: Buffer, mimeType: string): Promise<string> {
  const formData = new FormData();
  const blob = new Blob([audioBuffer.buffer as ArrayBuffer], { type: mimeType });
  formData.append("file", blob, `audio.${mimeType.split("/")[1]?.split(";")[0] ?? "webm"}`);
  formData.append("model", "whisper-1");
  formData.append("language", "pt");
  formData.append("response_format", "text");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: formData,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Whisper error ${res.status}: ${err}`);
  }
  return (await res.text()).trim();
}


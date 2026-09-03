"use client";

import { useRef, useState } from "react";

export type UploadedArtifact = { id: string; mimeType: string; byteSize: number; name: string; url: string };

export function ControlledFileUpload({ roomId, onUploaded }: { roomId: string; onUploaded: (artifact: UploadedArtifact) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  async function upload(file: File) {
    setError(""); setUploading(true);
    try {
      const form = new FormData(); form.append("file", file);
      const response = await fetch(`/api/rooms/${roomId}/uploads`, { method: "POST", body: form, credentials: "include" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error?.message ?? "上传失败");
      onUploaded(payload.artifact);
    } catch (e) { setError(e instanceof Error ? e.message : "上传失败"); }
    finally { setUploading(false); if (inputRef.current) inputRef.current.value = ""; }
  }
  return <div className="controlled-file-upload"><input ref={inputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain" disabled={uploading} onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file); }} />{uploading && <span role="status">上传中…</span>}{error && <span role="alert">{error}</span>}</div>;
}

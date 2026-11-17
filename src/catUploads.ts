// Shared by the upload site (src/web/) and the bot's review buttons/commands.
// Files live on the files server under one account; this module talks to its
// API, tracks uploads/uploaders in sqlite, and builds the review message.
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  escapeMarkdown,
} from "discord.js";
import { appendLink } from "./catLinks";
import { config } from "./config";
import { type CatUploaderRow, type CatUploadRow, db } from "./db";

// ---- files server (one storage account) ----

function filesHeaders(): Record<string, string> {
  if (!config.web.filesApiKey) throw new Error("CAT_FILES_API_KEY is not set");
  return { authorization: `Bearer ${config.web.filesApiKey}` };
}

export interface StoredFile {
  id: number;
  rawUrl: string;
}

export async function uploadToFiles(bytes: Uint8Array, filename: string, type: string): Promise<StoredFile> {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type }), filename);
  form.append("original_filename", filename);
  form.append("encryption_mode", "none");
  if (config.web.filesDirectoryId) form.append("directory_id", String(config.web.filesDirectoryId));
  const res = await fetch(`${config.web.filesBase}/api/files/upload`, {
    method: "POST",
    headers: filesHeaders(),
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  const json = (await res.json().catch(() => ({}))) as { id?: number; raw_url?: string; detail?: string };
  if (!res.ok || typeof json.id !== "number" || typeof json.raw_url !== "string") {
    throw new Error(`files upload failed: ${res.status} ${json.detail ?? ""}`.trim());
  }
  return { id: json.id, rawUrl: json.raw_url };
}

export async function deleteFromFiles(fileId: number): Promise<void> {
  const res = await fetch(`${config.web.filesBase}/api/files/${fileId}`, {
    method: "DELETE",
    headers: filesHeaders(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok && res.status !== 404) throw new Error(`files delete failed: ${res.status}`);
}

// ---- uploaders ----

export type UploaderStatus = "allowed" | "denied" | "review";

export function getUploaderStatus(userId: string): UploaderStatus {
  const row = db
    .query<CatUploaderRow, [string]>("SELECT * FROM cat_uploaders WHERE userId = ?")
    .get(userId);
  return row?.status ?? "review";
}

export function setUploaderStatus(userId: string, status: UploaderStatus, setBy: string): void {
  if (status === "review") {
    db.query("DELETE FROM cat_uploaders WHERE userId = ?").run(userId);
    return;
  }
  db.query(
    `INSERT INTO cat_uploaders (userId, status, setBy, updatedAt) VALUES (?, ?, ?, ?)
     ON CONFLICT(userId) DO UPDATE SET status = excluded.status, setBy = excluded.setBy, updatedAt = excluded.updatedAt`,
  ).run(userId, status, setBy, Date.now());
}

export function listUploaders(): CatUploaderRow[] {
  return db.query<CatUploaderRow, []>("SELECT * FROM cat_uploaders ORDER BY status, updatedAt DESC").all();
}

// ---- uploads ----

// Display name for an upload: no tabs/newlines (links.txt is tab-separated), trimmed, capped.
export function cleanUploadName(raw: string): string {
  return raw.replace(/[\t\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

export function createUpload(u: Omit<CatUploadRow, "id" | "reviewedBy" | "reviewChannelId" | "reviewMessageId" | "createdAt">): CatUploadRow {
  const result = db
    .query(
      `INSERT INTO cat_uploads (cat, name, uploaderId, uploaderName, fileId, url, contentType, status, reviewedBy, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      u.cat,
      u.name,
      u.uploaderId,
      u.uploaderName,
      u.fileId,
      u.url,
      u.contentType,
      u.status,
      u.status === "approved" ? "auto" : null,
      Date.now(),
    );
  if (u.status === "approved") appendLink(u.cat, { url: u.url, name: u.name, uploaderId: u.uploaderId });
  return getUpload(Number(result.lastInsertRowid))!;
}

export function getUpload(id: number): CatUploadRow | null {
  return db.query<CatUploadRow, [number]>("SELECT * FROM cat_uploads WHERE id = ?").get(id);
}

export function listPending(limit: number): CatUploadRow[] {
  return db
    .query<CatUploadRow, [number]>("SELECT * FROM cat_uploads WHERE status = 'pending' ORDER BY id LIMIT ?")
    .all(limit);
}

export function countPendingFor(userId: string): number {
  return (
    db
      .query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM cat_uploads WHERE status = 'pending' AND uploaderId = ?")
      .get(userId)?.n ?? 0
  );
}

export function setReviewMessage(id: number, channelId: string, messageId: string): void {
  db.query("UPDATE cat_uploads SET reviewChannelId = ?, reviewMessageId = ? WHERE id = ?").run(channelId, messageId, id);
}

// Atomic: only the first reviewer to click wins, so two admins can't both act on one upload.
// `rename` optionally overrides the name and/or cat on approval.
export function reviewUpload(
  id: number,
  decision: "approved" | "denied",
  reviewer: string,
  rename?: { name?: string; cat?: string },
): CatUploadRow | null {
  const claimed = db
    .query("UPDATE cat_uploads SET status = ?, reviewedBy = ? WHERE id = ? AND status = 'pending'")
    .run(decision, reviewer, id);
  if (claimed.changes === 0) return null;
  if (rename?.name) db.query("UPDATE cat_uploads SET name = ? WHERE id = ?").run(rename.name, id);
  if (rename?.cat) db.query("UPDATE cat_uploads SET cat = ? WHERE id = ?").run(rename.cat, id);
  const row = getUpload(id)!;
  if (decision === "approved") appendLink(row.cat, { url: row.url, name: row.name, uploaderId: row.uploaderId });
  return row;
}

// ---- review message ----

export function buildReviewMessage(u: CatUploadRow) {
  const statusText =
    u.status === "pending"
      ? "Waiting for review"
      : u.status === "approved"
        ? u.reviewedBy === "auto"
          ? "Added (trusted uploader)"
          : `Approved by <@${u.reviewedBy}>`
        : `Denied by <@${u.reviewedBy}>`;
  const embed = new EmbedBuilder()
    .setTitle(`Cat upload #${u.id}: ${escapeMarkdown(u.name)}`)
    .setURL(u.url)
    .addFields(
      { name: "Cat", value: escapeMarkdown(u.cat), inline: true },
      { name: "From", value: `<@${u.uploaderId}> (${escapeMarkdown(u.uploaderName)})`, inline: true },
      { name: "Status", value: statusText, inline: true },
    )
    .setTimestamp(u.createdAt);
  if (u.contentType.startsWith("image/") && u.status !== "denied") embed.setImage(u.url);
  if (u.contentType.startsWith("video/")) embed.setDescription(`Video: ${u.url}`);

  const components =
    u.status === "pending"
      ? [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`catupload:approve:${u.id}`).setLabel("Approve").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`catupload:rename:${u.id}`).setLabel("Approve with rename").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`catupload:trust:${u.id}`).setLabel("Approve + trust user").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`catupload:deny:${u.id}`).setLabel("Deny").setStyle(ButtonStyle.Danger),
          ),
        ]
      : [];
  return { embeds: [embed], components, allowedMentions: { parse: [] as never[] } };
}

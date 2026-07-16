import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";
import type { CommitDetail, CommitEntry } from "./git";
import type { UpdateStatus } from "./update";

export const GIT_LOG_PAGE_SIZE = 8;
const MAX_QUERY_LEN = 50;

const COLOR_OK = 0x57f287;
const COLOR_BEHIND = 0xfee75c;
const COLOR_WARN = 0xed4245;
const COLOR_NEUTRAL = 0x5865f2;

export type LogMode = "log" | "search";

function formatEntry(c: CommitEntry): string {
  return `\`${c.shortHash}\` ${c.subject}\n${" ".repeat(9)}${c.author} • ${c.date}`;
}

export function buildStatusEmbed(status: UpdateStatus): EmbedBuilder {
  const behind = status.commits.length;
  const color = status.dirty ? COLOR_WARN : behind > 0 ? COLOR_BEHIND : COLOR_OK;

  const embed = new EmbedBuilder()
    .setTitle("Git status")
    .setColor(color)
    .addFields(
      { name: "Branch", value: `\`${status.branch}\``, inline: true },
      { name: "Local", value: `\`${status.localCommit.slice(0, 7)}\``, inline: true },
      {
        name: "Remote",
        value: status.remoteCommit ? `\`${status.remoteCommit.slice(0, 7)}\`` : "unreachable",
        inline: true,
      },
    );

  if (status.remoteCommit) {
    embed.addFields({
      name: behind > 0 ? `${behind} commit(s) behind` : "Up to date",
      value:
        behind > 0
          ? formatCommitBlock(status.commits)
          : "Nothing to pull.",
    });
  }

  if (status.dirty) {
    embed.setFooter({ text: "Working tree has local changes not tracked by git." });
  }

  return embed;
}

const MAX_COMMITS_SHOWN = 15;

// Renders raw `git log --oneline` lines inside a code block so commit
// messages can't inject markdown formatting or ping @everyone/@here/roles.
export function formatCommitBlock(commits: string[]): string {
  const shown = commits.slice(0, MAX_COMMITS_SHOWN);
  const remainder = commits.length - shown.length;
  const suffix = remainder > 0 ? `\n… and ${remainder} more` : "";
  return `\`\`\`\n${shown.map((c) => `- ${c}`).join("\n")}${suffix}\n\`\`\``;
}

export function buildLogEmbed(opts: {
  mode: LogMode;
  query?: string;
  entries: CommitEntry[];
  page: number;
  totalPages: number;
  totalCount: number;
}): EmbedBuilder {
  const { mode, query, entries, page, totalPages, totalCount } = opts;
  const title = mode === "search" ? `Commit search: "${query}"` : "Commit log";

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(COLOR_NEUTRAL)
    .setDescription(entries.length > 0 ? entries.map(formatEntry).join("\n\n") : "No commits found.")
    .setFooter({ text: `Page ${page + 1} of ${Math.max(totalPages, 1)} • ${totalCount} commit(s)` });

  return embed;
}

export function buildLogComponents(
  mode: LogMode,
  page: number,
  totalPages: number,
  query = "",
): ActionRowBuilder<ButtonBuilder>[] {
  const encodedQuery = encodeURIComponent(query.slice(0, MAX_QUERY_LEN));
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`gitlog:${mode}:${page - 1}:${encodedQuery}`)
      .setLabel("◀ Prev")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId(`gitlog:${mode}:${page + 1}:${encodedQuery}`)
      .setLabel("Next ▶")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page + 1 >= totalPages),
  );
  return [row];
}

const MAX_FIELD_LEN = 1024;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

interface TreeNode {
  children: Map<string, TreeNode>;
}

function buildTreeLines(paths: string[]): string {
  const root: TreeNode = { children: new Map() };
  for (const path of paths) {
    let node = root;
    for (const part of path.split("/")) {
      let child = node.children.get(part);
      if (!child) {
        child = { children: new Map() };
        node.children.set(part, child);
      }
      node = child;
    }
  }

  const lines: string[] = [];
  const render = (node: TreeNode, prefix: string) => {
    const entries = [...node.children.entries()].sort(([a], [b]) => a.localeCompare(b));
    entries.forEach(([name, child], i) => {
      const isLast = i === entries.length - 1;
      const isDir = child.children.size > 0;
      lines.push(`${prefix}${isLast ? "└── " : "├── "}${name}${isDir ? "/" : ""}`);
      render(child, prefix + (isLast ? "    " : "│   "));
    });
  };
  render(root, "");
  return lines.join("\n");
}

const MAX_TREE_LEN = 3800;

export function buildTreeEmbed(ref: string, paths: string[]): EmbedBuilder {
  const tree = buildTreeLines(paths);
  const truncated = tree.length > MAX_TREE_LEN;
  const body = truncated ? `${tree.slice(0, MAX_TREE_LEN)}\n…` : tree;

  return new EmbedBuilder()
    .setTitle("Repo tree")
    .setColor(COLOR_NEUTRAL)
    .addFields({ name: "Ref", value: `\`${ref}\``, inline: true })
    .setDescription(paths.length > 0 ? `\`\`\`\n${body}\n\`\`\`` : "No files found.")
    .setFooter({ text: `${paths.length} file(s)${truncated ? " • truncated" : ""}` });
}

export function buildCommitEmbed(commit: CommitDetail): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(commit.subject || "(no subject)")
    .setColor(COLOR_NEUTRAL)
    .addFields(
      { name: "Hash", value: `\`${commit.shortHash}\``, inline: true },
      { name: "Author", value: commit.author || "unknown", inline: true },
      { name: "Date", value: commit.date || "unknown", inline: true },
    );

  if (commit.body) {
    embed.addFields({ name: "Message", value: truncate(commit.body, MAX_FIELD_LEN) });
  }
  if (commit.stat) {
    embed.addFields({ name: "Files changed", value: `\`\`\`\n${truncate(commit.stat, MAX_FIELD_LEN - 8)}\n\`\`\`` });
  }

  return embed;
}

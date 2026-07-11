import type { ButtonInteraction } from "discord.js";
import * as git from "../git";
import { buildLogComponents, buildLogEmbed, GIT_LOG_PAGE_SIZE, type LogMode } from "../gitView";

// customId shape: gitlog:<mode>:<page>:<encoded query>
// Log/search replies are ephemeral, so only the original invoker can ever see
// or click these buttons — no extra author check needed here.
export async function handleGitLogButton(interaction: ButtonInteraction) {
  const [, modeRaw, pageRaw, encodedQuery] = interaction.customId.split(":");
  const mode: LogMode = modeRaw === "search" ? "search" : "log";
  const query = encodedQuery ? decodeURIComponent(encodedQuery) : "";
  const grep = mode === "search" ? query : undefined;

  await interaction.deferUpdate();

  const totalCount = git.countCommits(grep);
  const totalPages = Math.max(1, Math.ceil(totalCount / GIT_LOG_PAGE_SIZE));
  const requestedPage = Number.parseInt(pageRaw ?? "0", 10) || 0;
  const page = Math.min(Math.max(requestedPage, 0), totalPages - 1);

  const entries = git.queryLog({ grep, skip: page * GIT_LOG_PAGE_SIZE, limit: GIT_LOG_PAGE_SIZE });

  await interaction.editReply({
    embeds: [buildLogEmbed({ mode, query, entries, page, totalPages, totalCount })],
    components: buildLogComponents(mode, page, totalPages, query),
  });
}

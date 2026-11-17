import {
  ActionRowBuilder,
  type ButtonInteraction,
  MessageFlags,
  ModalBuilder,
  type ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { normaliseCatName } from "../catLinks";
import {
  buildReviewMessage,
  cleanUploadName,
  deleteFromFiles,
  getUpload,
  reviewUpload,
  setUploaderStatus,
} from "../catUploads";
import type { CatUploadRow } from "../db";
import { logger } from "../logger";
import { canManageCatUploads } from "../permissions";
import { defineInteraction } from "../utils/defineInteraction";

const RENAME_MODAL = "catupload-rename:";

async function deny(interaction: ButtonInteraction | ModalSubmitInteraction, text: string) {
  await interaction.reply({ content: text, flags: MessageFlags.Ephemeral });
}

// Edit the message the button lives on (channel post or ephemeral /cat review),
// plus the review-channel post if this click came from somewhere else.
async function showResult(interaction: ButtonInteraction | ModalSubmitInteraction, row: CatUploadRow) {
  const msg = buildReviewMessage(row);
  if (interaction.isButton()) await interaction.update(msg);
  else if (interaction.isFromMessage()) await interaction.update(msg);
  else await interaction.reply({ content: "Done.", flags: MessageFlags.Ephemeral });

  if (row.reviewChannelId && row.reviewMessageId && interaction.message?.id !== row.reviewMessageId) {
    try {
      const channel = await interaction.client.channels.fetch(row.reviewChannelId);
      if (channel?.isTextBased()) {
        const posted = await channel.messages.fetch(row.reviewMessageId);
        await posted.edit(msg);
      }
    } catch (err) {
      logger.warn({ err, uploadId: row.id }, "Couldn't update cat review post");
    }
  }
}

async function handleButton(interaction: ButtonInteraction) {
  const [, action, idRaw] = interaction.customId.split(":");
  const id = Number(idRaw);
  if (!canManageCatUploads(interaction)) return deny(interaction, "You can't review cat uploads.");

  const upload = getUpload(id);
  if (!upload) return deny(interaction, "That upload no longer exists.");
  if (upload.status !== "pending") return deny(interaction, `Already ${upload.status}.`);

  if (action === "rename") {
    const modal = new ModalBuilder().setCustomId(`${RENAME_MODAL}${id}`).setTitle(`Approve upload #${id}`);
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("name")
          .setLabel("Name")
          .setStyle(TextInputStyle.Short)
          .setMaxLength(80)
          .setRequired(true)
          .setValue(upload.name),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("cat")
          .setLabel("Cat")
          .setStyle(TextInputStyle.Short)
          .setMaxLength(32)
          .setRequired(true)
          .setValue(upload.cat),
      ),
    );
    await interaction.showModal(modal);
    return;
  }

  if (action === "approve" || action === "trust") {
    const row = reviewUpload(id, "approved", interaction.user.id);
    if (!row) return deny(interaction, "Someone else just reviewed that one.");
    if (action === "trust") setUploaderStatus(row.uploaderId, "allowed", interaction.user.id);
    logger.info({ uploadId: id, by: interaction.user.id, trust: action === "trust" }, "Cat upload approved");
    return showResult(interaction, row);
  }

  if (action === "deny") {
    const row = reviewUpload(id, "denied", interaction.user.id);
    if (!row) return deny(interaction, "Someone else just reviewed that one.");
    try {
      await deleteFromFiles(row.fileId);
    } catch (err) {
      logger.warn({ err, uploadId: id, fileId: row.fileId }, "Couldn't delete denied cat upload from files server");
    }
    logger.info({ uploadId: id, by: interaction.user.id }, "Cat upload denied");
    return showResult(interaction, row);
  }
}

async function handleRename(interaction: ModalSubmitInteraction) {
  const id = Number(interaction.customId.slice(RENAME_MODAL.length));
  if (!canManageCatUploads(interaction)) return deny(interaction, "You can't review cat uploads.");

  const name = cleanUploadName(interaction.fields.getTextInputValue("name"));
  const cat = normaliseCatName(interaction.fields.getTextInputValue("cat"));
  if (!name) return deny(interaction, "Name can't be empty.");
  if (!cat) return deny(interaction, "Cat names can only use letters, numbers, - and _ (max 32).");

  const row = reviewUpload(id, "approved", interaction.user.id, { name, cat });
  if (!row) return deny(interaction, "That upload was already reviewed.");
  logger.info({ uploadId: id, by: interaction.user.id, name, cat }, "Cat upload approved with rename");
  return showResult(interaction, row);
}

export default [
  defineInteraction({ kind: "button", prefix: "catupload:", execute: handleButton }),
  defineInteraction({ kind: "modal", prefix: RENAME_MODAL, execute: handleRename }),
];

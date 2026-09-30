import { defineInteraction } from "../utils/defineInteraction";
import {
  ActionRowBuilder,
  ButtonInteraction,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { config } from "../config";
import { db } from "../db";
import { hasManagerRole } from "../permissions";
import { refreshQuiplashBoards } from "../quiplashView";

const MODAL_ID = "quiplash-add-modal";

export async function handleQuiplashButton(interaction: ButtonInteraction) {
  const [, action] = interaction.customId.split(":");
  if (action !== "add-modal") return;

  if (!hasManagerRole(interaction, config.quiplash.managerRoleIds)) {
    await interaction.reply({
      content: "You don't have permission to add prompts.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const modal = new ModalBuilder().setCustomId(MODAL_ID).setTitle("Add a Quiplash prompt");

  const promptInput = new TextInputBuilder()
    .setCustomId("prompt")
    .setLabel("Prompt text")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true);

  const categoryInput = new TextInputBuilder()
    .setCustomId("category")
    .setLabel("Category (optional)")
    .setPlaceholder(config.quiplash.defaultCategory)
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(promptInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(categoryInput),
  );

  await interaction.showModal(modal);
}

export async function handleQuiplashModalSubmit(interaction: ModalSubmitInteraction) {
  if (interaction.customId !== MODAL_ID) return;

  const guildId = interaction.guildId;
  if (!guildId) return;

  if (!hasManagerRole(interaction, config.quiplash.managerRoleIds)) {
    await interaction.reply({
      content: "You don't have permission to add prompts.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const text = interaction.fields.getTextInputValue("prompt").trim();
  if (!text) {
    await interaction.reply({ content: "Prompt text can't be empty.", flags: MessageFlags.Ephemeral });
    return;
  }
  const category = (
    interaction.fields.getTextInputValue("category").trim() || config.quiplash.defaultCategory
  ).toLowerCase();

  const result = db
    .query(
      "INSERT INTO prompts (guildId, category, text, addedBy, createdAt) VALUES (?, ?, ?, ?, ?)",
    )
    .run(guildId, category, text, interaction.user.id, Date.now());

  await refreshQuiplashBoards(interaction.client, guildId, category);

  await interaction.reply({
    content: `Added prompt #${Number(result.lastInsertRowid)} to **${category}**: "${text}"`,
    flags: MessageFlags.Ephemeral,
  });
}

export default [
  defineInteraction({ kind: "button", prefix: "quiplash:", execute: handleQuiplashButton }),
  defineInteraction({ kind: "modal", prefix: MODAL_ID, execute: handleQuiplashModalSubmit }),
];

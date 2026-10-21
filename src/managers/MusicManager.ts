import { Readable } from "node:stream";
import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  demuxProbe,
  entersState,
  StreamType,
  joinVoiceChannel,
  type AudioPlayer,
  type VoiceConnection,
} from "@discordjs/voice";
import type { Client, GuildTextBasedChannel, VoiceBasedChannel } from "discord.js";
import { config } from "../config";
import { Manager } from "../core/Manager";
import type { ManagerRegistry } from "../core/ManagerRegistry";
import { trackLabel, trackSource, type Track } from "../services/music/track";
import { ytdlpArgs } from "../services/music/ytdlp";

export type LoopMode = "off" | "track" | "queue";

export class GuildQueue {
  tracks: Track[] = [];
  current: Track | null = null;
  loop: LoopMode = "off";
  textChannel: GuildTextBasedChannel | null = null;
  private proc: ReturnType<typeof Bun.spawn> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private starting = false;
  private destroyed = false;

  constructor(
    private manager: MusicManager,
    readonly guildId: string,
    readonly connection: VoiceConnection,
    readonly player: AudioPlayer,
    public channelId: string,
  ) {
    player.on(AudioPlayerStatus.Idle, () => this.advance());
    player.on("error", (err) => {
      manager.logger.error({ err, track: this.current && trackLabel(this.current) }, "Audio player error");
      this.say(`Couldn't play ${this.current ? trackLabel(this.current) : "that track"}, skipping.`);
      this.advance(true);
    });
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        this.destroy();
      }
    });
    connection.on(VoiceConnectionStatus.Destroyed, () => this.destroy());
  }

  get playing(): boolean {
    return this.current !== null;
  }

  get paused(): boolean {
    return this.player.state.status === AudioPlayerStatus.Paused;
  }

  add(tracks: Track[], next = false): void {
    if (next) this.tracks.unshift(...tracks);
    else this.tracks.push(...tracks);
    this.clearIdle();
    if (!this.current && !this.starting) void this.advance();
  }

  skip(): void {
    // stop() fires Idle, which advances. Looping a track shouldn't trap a skip.
    if (this.loop === "track") this.loop = "off";
    if (!this.player.stop(true)) void this.advance();
  }

  clear(): void {
    this.tracks = [];
  }

  shuffle(): void {
    for (let i = this.tracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.tracks[i], this.tracks[j]] = [this.tracks[j]!, this.tracks[i]!];
    }
  }

  stop(): void {
    this.destroy();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearIdle();
    this.tracks = [];
    this.current = null;
    this.killProc();
    this.player.stop(true);
    if (this.connection.state.status !== VoiceConnectionStatus.Destroyed) this.connection.destroy();
    this.manager.queues.delete(this.guildId);
  }

  private say(text: string) {
    void this.textChannel?.send({ content: text, allowedMentions: { parse: [] } }).catch(() => {});
  }

  private killProc() {
    try {
      this.proc?.kill();
    } catch {}
    this.proc = null;
  }

  private clearIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private async advance(failed = false): Promise<void> {
    if (this.destroyed || this.starting) return;
    this.killProc();

    const prev = this.current;
    if (prev && !failed) {
      if (this.loop === "track") this.tracks.unshift(prev);
      else if (this.loop === "queue") this.tracks.push(prev);
    }
    this.current = this.tracks.shift() ?? null;

    if (!this.current) {
      if (config.music.idleLeaveSeconds > 0) {
        this.idleTimer = setTimeout(() => this.destroy(), config.music.idleLeaveSeconds * 1000);
      }
      return;
    }

    const track = this.current;
    this.starting = true;
    try {
      const proc = Bun.spawn(
        [
          config.music.ytdlpPath,
          ...ytdlpArgs(),
          "-q",
          "-f",
          "bestaudio[acodec=opus]/bestaudio",
          "-o",
          "-",
          trackSource(track),
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      this.proc = proc;
      // If yt-dlp dies before producing audio, surface its last line.
      const stderr = new Response(proc.stderr as ReadableStream).text();
      const input = Readable.fromWeb(proc.stdout as import("node:stream/web").ReadableStream);
      const probed = await demuxProbe(input);
      if (this.destroyed || this.current !== track) return;
      // Only WebM/Opus and Ogg/Opus pass through untouched; anything else needs ffmpeg.
      if (probed.type === StreamType.Arbitrary && !this.manager.ffmpeg) {
        this.manager.logger.warn({ track: trackLabel(track) }, "Skipping non-Opus source: ffmpeg not installed");
        probed.stream.destroy();
        throw new Error("source isn't Opus and ffmpeg isn't installed");
      }
      this.player.play(createAudioResource(probed.stream, { inputType: probed.type }));
      if (this.loop !== "track" || prev !== track) this.say(`Now playing: ${trackLabel(track)}`);
      void stderr.then((t) => t.trim() && this.manager.logger.debug({ stderr: t.trim() }, "yt-dlp"));
    } catch (err) {
      this.manager.logger.error({ err, track: trackLabel(track) }, "Failed to start track");
      this.say(`Couldn't play ${trackLabel(track)}, skipping.`);
      this.starting = false;
      // A track that fails to start must not be re-queued by loop.
      this.current = null;
      return this.advance(true);
    } finally {
      this.starting = false;
    }
  }
}

export class MusicManager extends Manager {
  readonly queues = new Map<string, GuildQueue>();
  ffmpeg = false;

  constructor(client: Client, registry: ManagerRegistry) {
    super("MusicManager", client, registry);
  }

  override async init(): Promise<void> {
    this.ffmpeg = Bun.which("ffmpeg") !== null;
    if (!this.ffmpeg) {
      this.log.warn("ffmpeg not found: Opus sources still play, non-Opus sources will be skipped");
    }
    if (!Bun.which(config.music.ytdlpPath)) {
      this.log.warn({ path: config.music.ytdlpPath }, "yt-dlp not found: /play will not work");
    }
  }

  get logger() {
    return this.log;
  }

  get(guildId: string): GuildQueue | undefined {
    return this.queues.get(guildId);
  }

  // Joins (or reuses) the guild's voice connection. Throws a readable Error
  // if the bot is already playing in a different channel.
  async join(channel: VoiceBasedChannel, textChannel: GuildTextBasedChannel | null): Promise<GuildQueue> {
    const existing = this.queues.get(channel.guildId);
    if (existing) {
      if (existing.channelId !== channel.id) throw new Error("I'm already playing in another voice channel.");
      existing.textChannel = textChannel ?? existing.textChannel;
      return existing;
    }

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guildId,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true,
    });
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
    } catch {
      connection.destroy();
      throw new Error("Couldn't join the voice channel.");
    }

    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
    connection.subscribe(player);
    const queue = new GuildQueue(this, channel.guildId, connection, player, channel.id);
    queue.textChannel = textChannel;
    this.queues.set(channel.guildId, queue);
    return queue;
  }

  override async stop(): Promise<void> {
    for (const q of [...this.queues.values()]) q.destroy();
  }
}

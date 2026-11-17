/**
 * Widget chat untuk website klien. Dipasang dengan satu baris:
 *
 *   <script src="https://alamat-server/widget.js" data-key="pk_..." async></script>
 *
 * Atribut tambahan: data-position="left" untuk menaruh tombol di kiri bawah.
 */
import { DEFAULT_ACCENT, isHexColor, readableOn } from "../../shared/color";
import { errorMessage, readReply, ReplyError, type ChatMessage } from "../../shared/reply-stream";
import { el, icon, ICON, renderMarkdown } from "./dom";
import styles from "./widget.css";

const HOST_ID = "sahut-widget";
const POLL_OPEN_MS = 4000;
const POLL_WAITING_MS = 15000;
const MAX_LENGTH = 2000;
const PAGE_SIZE = 200;
const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const TEXT = {
  offline: "Tidak bisa terhubung. Periksa koneksi internet Anda, lalu coba lagi.",
  sendFailed: "Pesan belum terkirim. Coba kirim lagi.",
  withStaff: "Anda terhubung dengan staf kami. Balasan staf akan muncul di sini.",
  searching: "Mencari informasi",
  staff: "Staf",
};

interface Config {
  businessName: string;
  botName: string;
  greeting: string;
  accentColor: string;
}

type Role = "customer" | "bot" | "agent";

// Harus dibaca saat skrip dijalankan. Setelah itu nilainya hilang.
const currentScript = document.currentScript as HTMLScriptElement | null;

/** Penyimpanan peramban bisa diblokir (mode privat, iframe terbatas). Widget tetap jalan tanpa itu. */
function store(area: "localStorage" | "sessionStorage") {
  return {
    get(key: string): string | null {
      try {
        return window[area].getItem(key);
      } catch {
        return null;
      }
    },
    set(key: string, value: string): void {
      try {
        window[area].setItem(key, value);
      } catch {
        // Cukup diingat selama halaman terbuka.
      }
    },
  };
}

const saved = store("localStorage");
const session = store("sessionStorage");

function randomId(): string {
  let id = "";
  for (const byte of crypto.getRandomValues(new Uint8Array(24))) id += ID_ALPHABET[byte % ID_ALPHABET.length];
  return id;
}

class ChatWidget {
  private readonly frame = el("div", "frame");
  private readonly launcher = el("button", "launcher");
  private readonly openIcon = icon(ICON.chat, 26);
  private readonly closeIcon = icon(ICON.down, 26);
  private readonly badge = el("span", "badge");
  private readonly panel = el("div", "panel");
  private readonly log = el("div", "log");
  private readonly notice = el("div", "notice", TEXT.withStaff);
  private readonly errorBar = el("div", "error");
  private readonly input = el("textarea");
  private readonly sendButton = el("button", "send");

  private readonly visitorKey: string;
  private readonly openKey: string;
  private visitorId: string | null;

  private open = false;
  private sending = false;
  private polling = false;
  private withStaff = false;
  private historyLoaded = false;
  private lastId = 0;
  private lastRole: Role | null = null;
  private staffSpoke = false;
  private pollTimer: number | undefined;
  private typingRow: HTMLElement | null = null;
  /** Pesan pelanggan yang sudah tampil tetapi belum dikonfirmasi server. Dicocokkan lewat isinya supaya tidak tampil dua kali. */
  private unconfirmed: string[] = [];
  private readonly seen = new Set<number>();
  private readonly mobile = window.matchMedia("(max-width: 480px)");

  constructor(
    private readonly api: string,
    publicKey: string,
    private readonly config: Config,
    position: "left" | "right",
  ) {
    this.visitorKey = `sahut:visitor:${publicKey}`;
    this.openKey = `sahut:open:${publicKey}`;
    this.visitorId = saved.get(this.visitorKey);
    if (this.visitorId && !/^[A-Za-z0-9_-]{8,64}$/.test(this.visitorId)) this.visitorId = null;

    this.build(position);
    this.addMessage("bot", config.greeting);

    // Pengunjung lama: muat riwayatnya. Pengunjung baru tidak memanggil server sampai mengirim pesan.
    if (this.visitorId) void this.poll();
    if (session.get(this.openKey) === "1") this.setOpen(true, false);
  }

  // --- Susunan elemen ---------------------------------------------------------

  private build(position: "left" | "right"): void {
    const accent = isHexColor(this.config.accentColor) ? this.config.accentColor : DEFAULT_ACCENT;
    this.frame.classList.add(position);
    this.frame.style.setProperty("--accent", accent);
    this.frame.style.setProperty("--on-accent", readableOn(accent));

    this.launcher.type = "button";
    this.launcher.setAttribute("aria-label", `Buka chat dengan ${this.config.botName}`);
    this.launcher.setAttribute("aria-expanded", "false");
    this.closeIcon.setAttribute("hidden", "");
    this.badge.hidden = true;
    this.launcher.append(this.openIcon, this.closeIcon, this.badge);
    this.launcher.addEventListener("click", () => this.setOpen(!this.open));

    const header = el("div", "header");
    const identity = el("div", "identity");
    identity.append(el("div", "name", this.config.botName), el("div", "sub", `Asisten otomatis ${this.config.businessName}`));
    const close = el("button", "close");
    close.type = "button";
    close.setAttribute("aria-label", "Tutup chat");
    close.append(icon(ICON.close, 20));
    close.addEventListener("click", () => this.setOpen(false));
    header.append(el("div", "avatar", this.config.botName.trim().charAt(0).toUpperCase() || "?"), identity, close);

    this.log.setAttribute("role", "log");
    this.log.setAttribute("aria-live", "polite");
    this.notice.hidden = true;
    this.errorBar.hidden = true;
    this.errorBar.setAttribute("role", "alert");

    const composer = el("form", "composer");
    this.input.rows = 1;
    this.input.maxLength = MAX_LENGTH;
    this.input.placeholder = "Tulis pesan…";
    this.input.setAttribute("aria-label", "Tulis pesan");
    this.sendButton.type = "submit";
    this.sendButton.disabled = true;
    this.sendButton.setAttribute("aria-label", "Kirim pesan");
    this.sendButton.append(icon(ICON.send, 20));
    composer.append(this.input, this.sendButton);

    composer.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.send();
    });
    this.input.addEventListener("input", () => {
      this.resizeInput();
      this.updateSendButton();
    });
    this.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        void this.send();
      }
    });

    this.panel.hidden = true;
    this.panel.setAttribute("role", "dialog");
    this.panel.setAttribute("aria-label", `Chat dengan ${this.config.botName}`);
    this.panel.append(header, this.log, this.notice, this.errorBar, composer);
    this.panel.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        this.setOpen(false);
        this.launcher.focus();
      }
    });

    this.frame.append(this.panel, this.launcher);

    const host = el("div");
    host.id = HOST_ID;
    const root = host.attachShadow({ mode: "open" });
    try {
      // Lembar gaya yang dibuat lewat skrip tidak terkena aturan CSP "style-src" milik website klien.
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(styles);
      root.adoptedStyleSheets = [sheet];
    } catch {
      root.append(el("style", undefined, styles));
    }
    root.append(this.frame);
    document.body.append(host);

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") this.schedulePoll(0);
    });
    window.visualViewport?.addEventListener("resize", () => this.fitToKeyboard());
    window.visualViewport?.addEventListener("scroll", () => this.fitToKeyboard());
  }

  // --- Buka dan tutup ---------------------------------------------------------

  private setOpen(open: boolean, focus = true): void {
    this.open = open;
    this.panel.hidden = !open;
    this.frame.classList.toggle("open", open);
    this.openIcon.toggleAttribute("hidden", open);
    this.closeIcon.toggleAttribute("hidden", !open);
    this.launcher.setAttribute("aria-expanded", String(open));
    this.launcher.setAttribute("aria-label", open ? "Tutup chat" : `Buka chat dengan ${this.config.botName}`);
    session.set(this.openKey, open ? "1" : "0");

    if (open) {
      this.badge.hidden = true;
      this.fitToKeyboard();
      this.scrollToBottom(true);
      // Di layar sentuh, fokus otomatis memunculkan papan ketik dan menutupi percakapan.
      if (focus && !window.matchMedia("(pointer: coarse)").matches) this.input.focus();
    }
    this.schedulePoll(open ? 0 : undefined);
  }

  /** Di ponsel, papan ketik menutupi bagian bawah layar. Jendela chat disusutkan ke area yang masih terlihat. */
  private fitToKeyboard(): void {
    const viewport = window.visualViewport;
    const fullscreen = this.open && this.mobile.matches && viewport;
    this.panel.style.top = fullscreen ? `${viewport.offsetTop}px` : "";
    this.panel.style.height = fullscreen ? `${viewport.height}px` : "";
    this.panel.style.bottom = fullscreen ? "auto" : "";
  }

  // --- Pesan -------------------------------------------------------------------

  private addMessage(role: Role, text: string): HTMLElement {
    const row = el("div", role === "customer" ? "row me" : "row");
    if (role === "agent") this.staffSpoke = true;
    // Setelah staf ikut membalas, tiap pergantian pembicara diberi nama supaya jelas siapa yang menjawab.
    if (role !== "customer" && role !== this.lastRole && this.staffSpoke) {
      row.append(el("div", "label", role === "agent" ? TEXT.staff : this.config.botName));
    }
    this.lastRole = role;

    const bubble = el("div", "bubble");
    if (role === "customer") bubble.textContent = text;
    else renderMarkdown(bubble, text);
    row.append(bubble);

    const stick = this.nearBottom();
    this.log.insertBefore(row, this.typingRow);
    if (stick) this.scrollToBottom(true);
    return bubble;
  }

  private showTyping(label?: string): void {
    this.hideTyping();
    const row = el("div", "row");
    const bubble = el("div", "bubble");
    const dots = el("div", "typing");
    dots.setAttribute("role", "status");
    dots.setAttribute("aria-label", label ?? `${this.config.botName} sedang menulis`);
    if (label) dots.append(el("span", undefined, label));
    dots.append(el("i"), el("i"), el("i"));
    bubble.append(dots);
    row.append(bubble);
    this.typingRow = row;
    this.log.append(row);
    this.scrollToBottom();
  }

  private hideTyping(): void {
    this.typingRow?.remove();
    this.typingRow = null;
  }

  private nearBottom(): boolean {
    return this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 80;
  }

  private scrollToBottom(force = false): void {
    if (force || this.nearBottom()) this.log.scrollTop = this.log.scrollHeight;
  }

  private setWithStaff(withStaff: boolean): void {
    this.withStaff = withStaff;
    this.notice.hidden = !withStaff;
  }

  private showError(message: string): void {
    this.errorBar.textContent = message;
    this.errorBar.hidden = false;
  }

  private resizeInput(): void {
    this.input.style.height = "auto";
    this.input.style.height = `${Math.min(this.input.scrollHeight + 2, 120)}px`;
  }

  private updateSendButton(): void {
    this.sendButton.disabled = this.sending || !this.input.value.trim();
  }

  // --- Mengirim pesan ------------------------------------------------------------

  private async send(): Promise<void> {
    const text = this.input.value.trim();
    if (!text || this.sending) return;

    this.sending = true;
    this.errorBar.hidden = true;
    if (!this.visitorId) {
      this.visitorId = randomId();
      saved.set(this.visitorKey, this.visitorId);
    }

    this.input.value = "";
    this.resizeInput();
    this.updateSendButton();
    const ownBubble = this.addMessage("customer", text);
    this.unconfirmed.push(text);
    this.scrollToBottom(true);
    this.showTyping();
    this.log.setAttribute("aria-busy", "true");

    let draft = "";
    let draftBubble: HTMLElement | null = null;
    let frameRequest = 0;
    const paint = () => {
      frameRequest = 0;
      if (!draftBubble) return;
      renderMarkdown(draftBubble, draft);
      this.scrollToBottom();
    };
    /** Pesan belum sampai ke server: kembalikan teksnya ke kolom tulis supaya mudah dikirim ulang. */
    const giveBack = (message: string) => {
      ownBubble.parentElement?.remove();
      this.unconfirmed.splice(this.unconfirmed.lastIndexOf(text), 1);
      if (!this.input.value) this.input.value = text;
      this.resizeInput();
      this.showError(message);
    };

    try {
      let response: Response;
      try {
        response = await fetch(`${this.api}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ visitorId: this.visitorId, text }),
        });
      } catch {
        giveBack(TEXT.offline);
        return;
      }
      if (!response.ok) {
        giveBack(await errorMessage(response, TEXT.sendFailed));
        return;
      }

      const result = await readReply(response, {
        onDelta: (delta) => {
          draft += delta;
          if (!draftBubble) {
            this.hideTyping();
            draftBubble = this.addMessage("bot", "");
          }
          frameRequest ||= requestAnimationFrame(paint);
        },
        onSearching: () => this.showTyping(TEXT.searching),
      });

      cancelAnimationFrame(frameRequest);
      this.hideTyping();
      if (result.customerMessageId !== null) {
        this.seen.add(result.customerMessageId);
        this.unconfirmed.splice(this.unconfirmed.lastIndexOf(text), 1);
      }
      const bubble = draftBubble as HTMLElement | null;
      if (result.message) {
        this.seen.add(result.message.id);
        if (bubble) renderMarkdown(bubble, result.message.content);
        else this.addMessage("bot", result.message.content);
      } else {
        bubble?.parentElement?.remove();
      }
      this.setWithStaff(result.withStaff);
      this.scrollToBottom();
    } catch (error) {
      // Aliran putus di tengah jalan. Pesan pelanggan mungkin sudah tersimpan, jadi keadaan akhirnya diambil lewat pemeriksaan berkala.
      cancelAnimationFrame(frameRequest);
      (draftBubble as HTMLElement | null)?.parentElement?.remove();
      this.showError(error instanceof ReplyError ? error.message : TEXT.offline);
    } finally {
      this.sending = false;
      this.hideTyping();
      this.log.removeAttribute("aria-busy");
      this.updateSendButton();
      this.schedulePoll(0);
    }
  }

  // --- Pemeriksaan berkala: balasan staf dan pesan dari tab lain -------------------

  private schedulePoll(delay?: number): void {
    window.clearTimeout(this.pollTimer);
    if (!this.visitorId) return;
    // Saat jendela tertutup, cukup memeriksa sesekali, dan hanya bila pelanggan sedang menunggu balasan staf.
    const wait = delay ?? (this.open ? POLL_OPEN_MS : this.withStaff ? POLL_WAITING_MS : null);
    if (wait !== null) this.pollTimer = window.setTimeout(() => void this.poll(), wait);
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    if (!this.visitorId || this.sending || document.visibilityState === "hidden") {
      this.schedulePoll();
      return;
    }

    this.polling = true;
    let more = false;
    try {
      const response = await fetch(`${this.api}/messages?visitorId=${encodeURIComponent(this.visitorId)}&after=${this.lastId}`);
      if (response.ok) {
        const data = (await response.json()) as { messages: ChatMessage[]; withStaff: boolean };
        // Selama pesan sedang dikirim, hasil ini bisa tumpang-tindih dengan jawaban yang sedang dialirkan. Lewati dulu.
        if (!this.sending) {
          this.absorb(data.messages);
          this.setWithStaff(data.withStaff);
          this.historyLoaded = true;
          more = data.messages.length >= PAGE_SIZE;
        }
      }
    } catch {
      // Jaringan sedang putus. Dicoba lagi pada putaran berikutnya.
    } finally {
      this.polling = false;
    }
    this.schedulePoll(more ? 0 : undefined);
  }

  private absorb(messages: ChatMessage[]): void {
    let fresh = false;
    for (const message of messages) {
      this.lastId = Math.max(this.lastId, message.id);
      if (this.seen.has(message.id) || message.role === "event") continue;
      this.seen.add(message.id);

      if (message.role === "customer") {
        const pending = this.unconfirmed.indexOf(message.content);
        if (pending !== -1) {
          this.unconfirmed.splice(pending, 1);
          continue;
        }
      } else {
        fresh = true;
      }
      this.addMessage(message.role, message.content);
    }
    if (fresh && !this.open && this.historyLoaded) this.badge.hidden = false;
  }
}

function start(): void {
  const script = currentScript ?? document.querySelector<HTMLScriptElement>('script[data-key][src*="widget.js"]');
  if (!script?.src) return;

  const publicKey = script.dataset.key?.trim();
  if (!publicKey) {
    console.warn("[Sahut] Atribut data-key belum diisi pada tag <script> widget.");
    return;
  }
  if (document.getElementById(HOST_ID)) return;

  const api = `${new URL(script.src).origin}/api/widget/${encodeURIComponent(publicKey)}`;
  const position = script.dataset.position === "left" ? "left" : "right";

  fetch(`${api}/config`)
    .then(async (response) => {
      if (!response.ok) throw new Error(await errorMessage(response, `server menjawab ${response.status}`));
      return (await response.json()) as Config;
    })
    .then((config) => {
      const mount = () => new ChatWidget(api, publicKey, config, position);
      if (document.body) mount();
      else document.addEventListener("DOMContentLoaded", mount, { once: true });
    })
    .catch((error: unknown) => {
      console.warn(`[Sahut] Widget tidak dimuat: ${error instanceof Error ? error.message : String(error)}`);
    });
}

start();

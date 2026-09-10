const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const pino = require("pino");
const QRCode = require("qrcode");
const path = require("path");
const fs = require("fs");

class WhatsAppService {
  constructor() {
    this.sock = null;
    this.status = "disconnected"; // "disconnected" | "connecting" | "qr_ready" | "connected"
    this.qrCode = null; // DataURL image string
    this.connectedUser = null; // { id, name, phone }
    this.sessionDir = path.join(__dirname, "../.whatsapp_session");
    this.isConnecting = false;
    this.saveCreds = null;
  }

  // Format any Indian or international phone number to WhatsApp JID
  formatPhoneToJid(mobile) {
    if (!mobile) return null;
    let digits = String(mobile).replace(/\D/g, "");
    if (!digits) return null;

    // Handle 10-digit Indian numbers (prefix 91)
    if (digits.length === 10) {
      digits = "91" + digits;
    } else if (digits.length === 11 && digits.startsWith("0")) {
      digits = "91" + digits.slice(1);
    }

    return {
      digits,
      jid: `${digits}@s.whatsapp.net`,
    };
  }

  // Generate a direct 1-click wa.me link for browser fallback
  createWaMeLink(mobile, text) {
    const formatted = this.formatPhoneToJid(mobile);
    if (!formatted) return "";
    return `https://wa.me/${formatted.digits}?text=${encodeURIComponent(text)}`;
  }

  // Initialize and connect to WhatsApp Multi-Device
  async connect() {
    if (this.isConnecting || this.status === "connected") {
      return { status: this.status, qrCode: this.qrCode, user: this.connectedUser };
    }

    this.isConnecting = true;
    this.status = "connecting";
    this.qrCode = null;

    try {
      if (!fs.existsSync(this.sessionDir)) {
        fs.mkdirSync(this.sessionDir, { recursive: true });
      }

      const { state, saveCreds } = await useMultiFileAuthState(this.sessionDir);
      this.saveCreds = saveCreds;

      this.sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        printQRInTerminal: true,
        browser: ["SocialFlipss Agency OS", "Chrome", "1.0.0"],
        syncFullHistory: false,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
      });

      this.sock.ev.on("creds.update", saveCreds);

      this.sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          try {
            this.qrCode = await QRCode.toDataURL(qr);
            this.status = "qr_ready";
            console.log("📲 [WhatsApp Bot] New QR Code generated. Ready to scan!");
          } catch (err) {
            console.error("QR generation error:", err);
          }
        }

        if (connection === "close") {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
          console.log(`[WhatsApp Bot] Connection closed (status: ${statusCode}). Reconnecting: ${shouldReconnect}`);

          this.status = "disconnected";
          this.connectedUser = null;
          this.qrCode = null;
          this.isConnecting = false;

          if (shouldReconnect) {
            setTimeout(() => this.connect(), 5000);
          } else {
            // Logged out - clear session directory
            this.clearSession();
          }
        } else if (connection === "open") {
          console.log("✅ [WhatsApp Bot] Connected successfully to WhatsApp!");
          this.status = "connected";
          this.qrCode = null;
          this.isConnecting = false;

          const userJid = this.sock.user?.id || "";
          const phone = userJid.split(":")[0] || userJid.split("@")[0];
          this.connectedUser = {
            id: userJid,
            name: this.sock.user?.name || "SocialFlipss Admin",
            phone: phone,
          };
        }
      });

      return { status: this.status, qrCode: this.qrCode, user: this.connectedUser };
    } catch (err) {
      console.error("[WhatsApp Bot] Connection error:", err);
      this.status = "disconnected";
      this.isConnecting = false;
      return { status: "disconnected", error: err.message };
    }
  }

  // Clear local session files (logout)
  clearSession() {
    try {
      if (this.sock) {
        this.sock.logout().catch(() => {});
      }
      if (fs.existsSync(this.sessionDir)) {
        fs.rmSync(this.sessionDir, { recursive: true, force: true });
      }
      this.status = "disconnected";
      this.connectedUser = null;
      this.qrCode = null;
      console.log("🗑️ [WhatsApp Bot] Session cleared. User logged out.");
    } catch (err) {
      console.error("Error clearing session:", err);
    }
  }

  // Get current status
  getStatus() {
    return {
      status: this.status,
      connected: this.status === "connected",
      user: this.connectedUser,
      qrCode: this.qrCode,
    };
  }

  // Send automatic PDF document to any mobile number (₹0, Free)
  async sendWhatsAppDocument(mobile, documentBuffer, fileName, caption = "") {
    const formatted = this.formatPhoneToJid(mobile);
    const waLink = this.createWaMeLink(mobile, caption);

    if (!formatted) {
      return {
        success: false,
        error: "Invalid or missing mobile number",
        waLink,
      };
    }

    if (this.status !== "connected" || !this.sock) {
      console.warn("[WhatsApp Bot] Cannot auto-send document: Bot is not connected. Providing fallback link.");
      return {
        success: false,
        reason: "bot_not_connected",
        message: "WhatsApp Bot is not connected. Scan QR Code in Admin Dashboard.",
        phone: formatted.digits,
        waLink,
      };
    }

    try {
      const result = await this.sock.sendMessage(formatted.jid, {
        document: documentBuffer,
        mimetype: "application/pdf",
        fileName: fileName || "Invoice.pdf",
        caption: caption || "",
      });
      console.log(`🚀 [WhatsApp Bot] Auto-sent PDF Document to ${formatted.digits} (Message ID: ${result?.key?.id})`);
      return {
        success: true,
        messageId: result?.key?.id,
        phone: formatted.digits,
        fileName,
        waLink,
      };
    } catch (err) {
      console.error(`[WhatsApp Bot] Failed to send PDF document to ${formatted.digits}:`, err.message);
      return {
        success: false,
        error: err.message,
        phone: formatted.digits,
        waLink,
      };
    }
  }

  // Send automatic WhatsApp message to any mobile number (₹0, Free)
  async sendWhatsAppMessage(mobile, messageText) {
    const formatted = this.formatPhoneToJid(mobile);
    const waLink = this.createWaMeLink(mobile, messageText);

    if (!formatted) {
      return {
        success: false,
        error: "Invalid or missing mobile number",
        waLink,
      };
    }

    if (this.status !== "connected" || !this.sock) {
      console.warn(`[WhatsApp Bot] Cannot auto-send: Bot is not connected. Providing fallback 1-click link.`);
      return {
        success: false,
        reason: "bot_not_connected",
        message: "WhatsApp Bot is not connected. Use the 1-click button to send via WhatsApp Web.",
        waLink,
      };
    }

    try {
      const result = await this.sock.sendMessage(formatted.jid, { text: messageText });
      console.log(`🚀 [WhatsApp Bot] Auto-sent message to ${formatted.digits} (Message ID: ${result?.key?.id})`);
      return {
        success: true,
        messageId: result?.key?.id,
        phone: formatted.digits,
        waLink,
      };
    } catch (err) {
      console.error(`[WhatsApp Bot] Failed to send message to ${formatted.digits}:`, err.message);
      return {
        success: false,
        error: err.message,
        waLink,
      };
    }
  }
}

// Singleton instance
const whatsappService = new WhatsAppService();
module.exports = whatsappService;

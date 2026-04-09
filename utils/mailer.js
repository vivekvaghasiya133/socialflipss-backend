const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD, // Gmail App Password (not regular password)
  },
});

// ── Leave Applied — notify admin ──────────────────────────────────
async function sendLeaveAppliedToAdmin({ staffName, staffPosition, fromDate, toDate, leaveType, reason }) {
  await transporter.sendMail({
    from:    `"SocialFlipss HR" <${process.env.GMAIL_USER}>`,
    to:      process.env.ADMIN_EMAIL,
    subject: `📋 New Leave Request — ${staffName}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
        <div style="background:#1a56db;padding:24px 28px;">
          <h2 style="color:#fff;margin:0;font-size:18px;">New Leave Request</h2>
          <p style="color:#bfdbfe;margin:4px 0 0;font-size:13px;">SocialFlipss HR System</p>
        </div>
        <div style="padding:24px 28px;">
          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            <tr><td style="padding:8px 0;color:#6b7280;width:140px;">Staff Name</td><td style="padding:8px 0;font-weight:600;">${staffName}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;">Position</td><td style="padding:8px 0;">${staffPosition}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;">From</td><td style="padding:8px 0;">${fromDate}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;">To</td><td style="padding:8px 0;">${toDate}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;">Type</td><td style="padding:8px 0;">${leaveType === "half_day" ? "Half Day" : "Full Day"}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;vertical-align:top;">Reason</td><td style="padding:8px 0;">${reason}</td></tr>
          </table>
          <div style="margin-top:20px;padding:14px;background:#f9fafb;border-radius:8px;font-size:13px;color:#6b7280;">
            Admin panel par jaaine approve ya reject karo.
          </div>
        </div>
      </div>
    `,
  });
}

// ── Leave Status Update — notify staff ───────────────────────────
async function sendLeaveStatusToStaff({ staffEmail, staffName, status, fromDate, toDate, adminNote }) {
  const approved = status === "approved";
  const color    = approved ? "#0e9f6e" : "#e02424";
  const emoji    = approved ? "✅" : "❌";
  const label    = approved ? "Approved" : "Rejected";

  await transporter.sendMail({
    from:    `"SocialFlipss HR" <${process.env.GMAIL_USER}>`,
    to:      staffEmail,
    subject: `${emoji} Leave ${label} — ${fromDate} to ${toDate}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
        <div style="background:${color};padding:24px 28px;">
          <h2 style="color:#fff;margin:0;font-size:18px;">Leave ${label}</h2>
          <p style="color:#fff;opacity:0.8;margin:4px 0 0;font-size:13px;">SocialFlipss HR System</p>
        </div>
        <div style="padding:24px 28px;">
          <p style="font-size:15px;color:#111;">Hi <strong>${staffName}</strong>,</p>
          <p style="font-size:14px;color:#374151;">
            Tamari leave request <strong style="color:${color};">${label}</strong> thayi chhe.
          </p>
          <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:16px;">
            <tr><td style="padding:8px 0;color:#6b7280;width:140px;">From</td><td style="padding:8px 0;">${fromDate}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;">To</td><td style="padding:8px 0;">${toDate}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;">Status</td><td style="padding:8px 0;font-weight:600;color:${color};">${label}</td></tr>
            ${adminNote ? `<tr><td style="padding:8px 0;color:#6b7280;vertical-align:top;">Admin Note</td><td style="padding:8px 0;">${adminNote}</td></tr>` : ""}
          </table>
          <div style="margin-top:20px;padding:14px;background:#f9fafb;border-radius:8px;font-size:13px;color:#6b7280;">
            Koi sawaal hoy to admin ne contact karo.
          </div>
        </div>
      </div>
    `,
  });
}

module.exports = { sendLeaveAppliedToAdmin, sendLeaveStatusToStaff };

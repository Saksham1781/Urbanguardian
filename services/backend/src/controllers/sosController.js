const nodemailer = require("nodemailer");

const SOS_TO = process.env.SOS_TO_EMAIL || "priyanshutiwari1010@gmail.com";

// Reuse transporter across requests
let transporter;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.SOS_FROM_EMAIL,
        pass: process.env.SOS_FROM_PASS,
      },
    });
  }
  return transporter;
}

async function sendSOS(req, res) {
  const { lat, lng, accuracy } = req.body;

  if (lat === undefined || lng === undefined) {
    return res.status(400).json({ error: "lat and lng are required" });
  }

  const hasLocation = lat !== 0 || lng !== 0;
  const mapsUrl = `https://maps.google.com/?q=${lat},${lng}`;
  const timestamp = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

  const locationBlock = hasLocation
    ? `<div style="background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;margin-bottom:20px">
        <div style="color:#7a8ba5;font-size:11px;margin-bottom:6px;text-transform:uppercase;letter-spacing:1px">Coordinates</div>
        <div style="color:#fff;font-size:16px">
          ${lat.toFixed(6)}, ${lng.toFixed(6)}
        </div>
        ${accuracy ? `<div style="color:#7a8ba5;font-size:12px;margin-top:4px">Accuracy: ±${Math.round(accuracy)} m</div>` : ""}
      </div>
      <a href="${mapsUrl}"
         style="display:inline-block;background:#ff3d57;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:14px">
        OPEN IN GOOGLE MAPS
      </a>`
    : `<div style="background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;margin-bottom:20px">
        <div style="color:#ffa726;font-size:14px">⚠ Location could not be determined — user may have denied GPS access.</div>
      </div>`;

  const html = `
    <div style="font-family:monospace;background:#0d1117;color:#e6edf3;padding:32px;border-radius:12px;max-width:500px">
      <div style="color:#ff3d57;font-size:22px;font-weight:bold;margin-bottom:16px">
        🚨 SOS ALERT — Urban Guardians
      </div>
      <div style="color:#8892a4;font-size:13px;margin-bottom:24px">
        Sent at ${timestamp} (IST)
      </div>
      ${locationBlock}
    </div>
  `;

  const subject = hasLocation
    ? `🚨 SOS ALERT — ${lat.toFixed(4)}, ${lng.toFixed(4)}`
    : `🚨 SOS ALERT — Location unknown`;

  try {
    await getTransporter().sendMail({
      from: `"Urban Guardians SOS" <${process.env.SOS_FROM_EMAIL}>`,
      to: SOS_TO,
      subject,
      html,
    });
    console.log(`SOS alert sent to ${SOS_TO} (location: ${hasLocation ? `${lat},${lng}` : "unknown"})`);
    res.json({ ok: true });
  } catch (err) {
    console.error("SOS email error:", err.message);
    res.status(500).json({ error: "Failed to send SOS email", details: err.message });
  }
}

module.exports = { sendSOS };

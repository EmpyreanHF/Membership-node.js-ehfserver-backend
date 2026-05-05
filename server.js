"use strict";

const express = require("express");
const cors    = require("cors");
const sgMail  = require("@sendgrid/mail");
const QRCode  = require("qrcode");

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const app = express();

// Open CORS — allows all origins (browser clients from any domain)
app.use(cors());

// Large body limit to handle base64 member photo
app.use(express.json({ limit: "12mb" }));
app.use(express.urlencoded({ extended: true, limit: "12mb" }));

const FROM_EMAIL = "infotech@empyreanhumanitarianfoundation.com";
const FROM_NAME  = "Empyrean Humanitarian Foundation";
const ORG_NAME   = "EMPYREAN HUMANITARIAN FOUNDATION";
const ORG_ADDR   = "19th Isolo Way, Off Int'l Airport Road, Ajao Estate, Lagos";
const CAC_REG    = "CAC/IT/7666250";

function parseDataUrl(dataUrl) {
    if (!dataUrl || typeof dataUrl !== "string") return null;
    const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    return m ? { mimeType: m[1], data: m[2] } : null;
}

function bioRow(label, value) {
    if (!value) return "";
    return `<tr>
      <td style="padding:7px 0;vertical-align:top;width:42%;"><span style="color:rgba(255,215,0,0.65);font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">${label}</span></td>
      <td style="padding:7px 0;vertical-align:top;"><span style="color:#e2e8f0;font-size:13px;">${value}</span></td>
    </tr>`;
}

// ─────────────────────────────────────────────────────────────────
//  STATUS ROUTES
// ─────────────────────────────────────────────────────────────────
app.get("/",       (_req, res) => res.send("EHF Membership Service — Online"));
app.get("/status", (_req, res) => res.send("Service is running fine"));

// ─────────────────────────────────────────────────────────────────
//  /config  — serves all API keys/config to the frontend securely
//  Called by index.html on page load via loadEHFConfig()
// ─────────────────────────────────────────────────────────────────
app.get("/config", (_req, res) => {
    res.json({
        // Firebase config
        firebase: {
            apiKey:            process.env.FIREBASE_API_KEY            || "",
            authDomain:        process.env.FIREBASE_AUTH_DOMAIN        || "",
            projectId:         process.env.FIREBASE_PROJECT_ID         || "",
            storageBucket:     process.env.FIREBASE_STORAGE_BUCKET     || "",
            messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID|| "",
            appId:             process.env.FIREBASE_APP_ID             || "",
        },
        // Cloudinary (unsigned upload)
        cloudName:    process.env.CLOUDINARY_CLOUD_NAME    || "",
        uploadPreset: process.env.CLOUDINARY_UPLOAD_PRESET || "",
        // Flutterwave payment
        flwPublicKey: process.env.FLW_PUBLIC_KEY           || "",
    });
});

// ─────────────────────────────────────────────────────────────────
//  /admin/verify  — simple admin PIN check (used by admin portal)
// ─────────────────────────────────────────────────────────────────
app.post("/admin/verify", (req, res) => {
    const { pin } = req.body || {};
    const ADMIN_PIN = process.env.ADMIN_PIN || "";
    if (!ADMIN_PIN) return res.status(500).json({ error: "Admin PIN not configured on server." });
    if (pin === ADMIN_PIN) return res.status(200).json({ success: true });
    return res.status(403).json({ error: "Invalid PIN." });
});

// ─────────────────────────────────────────────────────────────────
//  /send-email  — membership confirmation email via SendGrid
// ─────────────────────────────────────────────────────────────────
app.post("/send-email", async (req, res) => {
    try {
        const {
            fullName = "", dob = "", gender = "", occupation = "",
            maritalStatus = "", phone = "", email = "", address = "",
            country = "", stateResidence = "", lgaResidence = "",
            stateOrigin = "", lgaOrigin = "", diasporaRegion = "",
            region = "", memberId = "", executivePosition = "",
            photoDataUrl = "", welcomeMessage = "", membershipRules = "",
            subject = "Welcome to Empyrean Humanitarian Foundation — Membership Confirmation",
        } = req.body;

        if (!email) {
            return res.status(400).json({ error: "Member email address is required." });
        }

        const memberLocation = country === "Nigeria"
            ? [stateResidence, lgaResidence, address].filter(Boolean).join(", ")
            : [diasporaRegion || region, country, address].filter(Boolean).join(", ");

        const qrDataUrl = await QRCode.toDataURL(`VERIFIED_EHF_${memberId || email}`, {
            errorCorrectionLevel: "H", type: "image/png", width: 220, margin: 2,
            color: { dark: "#000000", light: "#FFFFFF" }
        });

        const attachments = [];
        const qrParsed = parseDataUrl(qrDataUrl);
        if (qrParsed) attachments.push({ content: qrParsed.data, filename: "membership-qr.png", type: "image/png", disposition: "inline", content_id: "memberQrCode" });

        const photoParsed = parseDataUrl(photoDataUrl);
        const hasPhoto = !!photoParsed;
        if (hasPhoto) attachments.push({ content: photoParsed.data, filename: "member-photo.jpg", type: photoParsed.mimeType || "image/jpeg", disposition: "inline", content_id: "memberPhoto" });

        const photoBlock = hasPhoto
            ? `<img src="cid:memberPhoto" alt="Member Photo" style="width:120px;height:120px;object-fit:cover;border-radius:50%;border:3px solid #FFD700;display:block;margin:0 auto 8px;">`
            : `<div style="width:120px;height:120px;border-radius:50%;background:#0f172a;border:3px solid #FFD700;line-height:120px;text-align:center;font-size:48px;margin:0 auto 8px;">👤</div>`;

        const execBadge = executivePosition
            ? `<div style="display:inline-block;background:#4a0080;border:1px solid #a855f7;color:#e9d5ff;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;padding:5px 16px;border-radius:20px;margin-bottom:14px;">👑 ${executivePosition}</div><br>`
            : "";

        const welcome = welcomeMessage || `Dear ${fullName},\n\nWe are delighted to welcome you to the Empyrean Humanitarian Foundation (EHF). Your registration has been successfully completed, and you are now formally recognised as a valued member of our growing community.\n\nYour Membership ID is: ${memberId}\n\nPlease keep this ID and the attached QR code safe. They serve as your official credentials at all EHF events.\n\nWarm regards,\nThe EHF Membership Team\n${CAC_REG} | ${ORG_ADDR}`;

        const rules = membershipRules || `MEMBERSHIP CONDUCT & COMPLIANCE CHARTER\n\n1. UPHOLD INTEGRITY\n   Conduct all activities with honesty, transparency, and accountability.\n\n2. RESPECT OTHERS\n   Treat fellow members and the communities we serve with dignity and compassion.\n\n3. ACTIVELY CONTRIBUTE\n   Participate in humanitarian initiatives and vocational training programmes.\n\n4. PROMOTE UNITY\n   Foster collaboration, inclusiveness, and teamwork in all engagements.\n\n5. FOLLOW GUIDELINES\n   Adhere to the foundation's rules, policies, and ethical standards.\n\n6. CHAMPION EMPOWERMENT\n   Support efforts to unlock the hidden potential of the less privileged.\n\nDISCLAIMER: Membership in EHF is a privilege. Violation of any rules will attract disciplinary action including suspension or revocation of membership.`;

        const rulesHtml = rules.split("\n").map(line => {
            const t = line.trim();
            if (!t) return "";
            if (/^MEMBERSHIP CONDUCT/i.test(t)) return `<div style="color:#FFD700;font-size:13px;font-weight:700;letter-spacing:1px;margin:20px 0 10px;">${t}</div>`;
            if (/^\d+\./.test(t)) return `<div style="color:#e2e8f0;font-size:13px;font-weight:700;margin:12px 0 4px;">${t}</div>`;
            if (/^DISCLAIMER/i.test(t)) return `<div style="color:#fbbf24;font-size:11.5px;font-style:italic;margin-top:16px;line-height:1.7;">${t}</div>`;
            return `<div style="color:#94a3b8;font-size:12.5px;line-height:1.75;margin:2px 0 2px 14px;">${t}</div>`;
        }).join("");

        const locationRows = country === "Nigeria"
            ? bioRow("State of Residence", stateResidence) + bioRow("LGA of Residence", lgaResidence) + bioRow("State of Origin", stateOrigin) + bioRow("LGA of Origin", lgaOrigin)
            : bioRow("Region / Province", diasporaRegion || region);

        const htmlContent = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#020617;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#020617;"><tr><td align="center" style="padding:36px 12px;">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-radius:20px;overflow:hidden;border:2px solid #FFD700;box-shadow:0 30px 80px rgba(0,0,0,0.8);">
<tr><td style="background:linear-gradient(135deg,#020617,#0f172a,#1a0533);padding:36px 40px;text-align:center;border-bottom:2px solid #FFD700;">
  <div style="font-size:10px;font-weight:700;letter-spacing:4px;color:rgba(255,215,0,0.55);margin-bottom:10px;">${CAC_REG}</div>
  <div style="color:#FFD700;font-size:21px;font-weight:900;letter-spacing:2px;text-transform:uppercase;">${ORG_NAME}</div>
  <div style="width:60px;height:2px;background:linear-gradient(90deg,transparent,#FFD700,transparent);margin:14px auto;"></div>
  <div style="color:rgba(255,255,255,0.5);font-size:11px;letter-spacing:3px;text-transform:uppercase;">Official Membership Confirmation</div>
</td></tr>
<tr><td style="background:linear-gradient(135deg,#800080,#4a0060);padding:18px 40px;text-align:center;">
  <div style="color:#fff;font-size:15px;font-weight:700;">🎉 Welcome to the EHF Family!</div>
</td></tr>
<tr><td style="background:#0a1224;padding:36px 40px;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr>
    <td width="170" valign="top" style="padding-right:28px;text-align:center;">
      <div style="background:rgba(255,215,0,0.06);border:1px solid rgba(255,215,0,0.2);border-radius:16px;padding:18px 12px;">
        ${photoBlock}
        <div style="color:rgba(255,255,255,0.3);font-size:9px;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:14px;">Member Photo</div>
        <div style="height:1px;background:rgba(255,215,0,0.15);margin-bottom:14px;"></div>
        <img src="cid:memberQrCode" alt="QR" style="width:160px;height:160px;display:block;margin:0 auto;">
        <div style="color:rgba(255,255,255,0.3);font-size:9px;letter-spacing:1.5px;text-transform:uppercase;margin-top:6px;">Scan to Verify</div>
      </div>
    </td>
    <td valign="top">
      <div style="font-size:9px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:rgba(255,215,0,0.5);margin-bottom:5px;">Member Name</div>
      <div style="color:#fff;font-size:19px;font-weight:900;text-transform:uppercase;margin-bottom:4px;">${fullName}</div>
      ${execBadge}
      <div style="width:40px;height:2px;background:linear-gradient(90deg,#FFD700,transparent);margin:10px 0 16px;"></div>
      <div style="background:rgba(255,215,0,0.09);border:1px solid rgba(255,215,0,0.35);border-radius:10px;padding:12px 16px;margin-bottom:14px;">
        <div style="color:rgba(255,215,0,0.6);font-size:9px;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px;">Membership ID</div>
        <div style="color:#FFD700;font-size:16px;font-weight:900;letter-spacing:2px;font-family:'Courier New',monospace;">${memberId}</div>
      </div>
      <table width="100%" cellpadding="0" cellspacing="0">
        ${bioRow("Country", country)}${bioRow("Phone", phone)}${bioRow("Gender", gender)}
        ${bioRow("Date of Birth", dob)}${bioRow("Occupation", occupation)}
        ${bioRow("Marital Status", maritalStatus)}${bioRow("Address", address)}${locationRows}
      </table>
    </td>
  </tr></table>
</td></tr>
<tr><td style="background:#060d1a;padding:32px 40px;border-top:1px solid rgba(255,215,0,0.12);">
  <div style="font-size:9px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:rgba(255,215,0,0.6);margin-bottom:14px;">Welcome Message</div>
  <div style="color:#e2e8f0;font-size:13.5px;line-height:1.85;white-space:pre-line;">${welcome}</div>
</td></tr>
<tr><td style="background:#0a1224;padding:32px 40px;border-top:1px solid rgba(255,215,0,0.12);">
  <div style="font-size:9px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:rgba(255,215,0,0.6);margin-bottom:14px;">Membership Rules & Conduct</div>
  ${rulesHtml}
</td></tr>
<tr><td style="background:linear-gradient(135deg,rgba(128,0,128,0.28),rgba(2,6,23,0.95));border-top:1px solid rgba(128,0,128,0.4);padding:28px 40px;text-align:center;">
  <div style="color:#c87eff;font-size:9px;font-weight:700;letter-spacing:3px;text-transform:uppercase;margin-bottom:16px;">Your Verification QR Code</div>
  <div style="background:#fff;display:inline-block;border-radius:14px;padding:14px;">
    <img src="cid:memberQrCode" alt="QR Code" style="width:180px;height:180px;display:block;">
  </div>
  <div style="color:rgba(255,255,255,0.45);font-size:11px;margin-top:12px;line-height:1.7;">
    Present this QR code at all EHF events to verify your membership.<br>
    <strong style="color:#c87eff;">ID: ${memberId}</strong>
  </div>
</td></tr>
<tr><td style="background:linear-gradient(135deg,#020617,#0a0f1e);padding:28px 40px;text-align:center;border-top:1px solid rgba(255,215,0,0.2);">
  <div style="color:#FFD700;font-size:12px;font-weight:700;letter-spacing:1px;margin-bottom:5px;">${ORG_NAME}</div>
  <div style="color:rgba(255,255,255,0.4);font-size:11px;margin-bottom:5px;">${ORG_ADDR}</div>
  <div style="color:rgba(255,255,255,0.3);font-size:10px;margin-bottom:14px;">${CAC_REG}</div>
  <div style="color:rgba(255,255,255,0.2);font-size:10px;line-height:1.7;">
    This is an automated confirmation. Please do not reply directly to this message.<br>
    Enquiries: <span style="color:rgba(255,215,0,0.5);">${FROM_EMAIL}</span>
  </div>
</td></tr>
</table></td></tr></table>
</body></html>`;

        const textContent = [
            ORG_NAME, "Official Membership Confirmation", "",
            `Dear ${fullName},`, "", welcome, "",
            "────────────────────────────────────", "MEMBERSHIP DETAILS", "────────────────────────────────────",
            `Membership ID : ${memberId}`,
            executivePosition ? `Position      : ${executivePosition}` : null,
            country           ? `Country       : ${country}`           : null,
            phone             ? `Phone         : ${phone}`             : null,
            gender            ? `Gender        : ${gender}`            : null,
            dob               ? `Date of Birth : ${dob}`               : null,
            occupation        ? `Occupation    : ${occupation}`        : null,
            maritalStatus     ? `Marital       : ${maritalStatus}`     : null,
            memberLocation    ? `Location      : ${memberLocation}`    : null,
            "", "────────────────────────────────────", rules,
            "────────────────────────────────────", "", ORG_NAME, ORG_ADDR, CAC_REG,
        ].filter(l => l !== null).join("\n");

        await sgMail.send({
            to: email,
            from: { email: FROM_EMAIL, name: FROM_NAME },
            subject, text: textContent, html: htmlContent,
            attachments: attachments.length ? attachments : undefined,
        });

        console.log(`[${new Date().toISOString()}] Email sent to ${email} | ID: ${memberId}`);
        return res.status(200).json({ success: true, message: "Email sent successfully." });

    } catch (error) {
        const detail = error.response ? JSON.stringify(error.response.body) : error.message;
        console.error(`[${new Date().toISOString()}] Send failed:`, detail);
        return res.status(500).json({ error: "Failed to send email.", detail });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`EHF Membership Service running on port ${PORT}`));
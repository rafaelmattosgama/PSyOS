import nodemailer from "nodemailer";

type EmailPayload = {
  to: string;
  subject: string;
  text: string;
};

let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (transporter) {
    return transporter;
  }
  const smtpUrl = process.env.SMTP_URL;
  if (!smtpUrl) {
    throw new Error("SMTP_URL is not configured");
  }
  transporter = nodemailer.createTransport(smtpUrl);
  return transporter;
}

export async function sendEmail(payload: EmailPayload) {
  const from = process.env.EMAIL_FROM;
  if (!from) {
    throw new Error("EMAIL_FROM is not configured");
  }
  const transport = getTransporter();
  await transport.sendMail({
    from,
    to: payload.to,
    subject: payload.subject,
    text: payload.text,
  });
}

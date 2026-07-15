import nodemailer from 'nodemailer'
import fs from 'fs'
import path from 'path'

export interface EmailParams {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail({ to, subject, html }: EmailParams): Promise<{ success: boolean; message: string }> {
  // Option 1: Resend API
  if (process.env.RESEND_API_KEY && process.env.RESEND_API_KEY !== 'placeholder_resend_key') {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: process.env.SMTP_FROM || 'Flashcards <onboarding@resend.dev>',
          to,
          subject,
          html,
        }),
      });

      if (response.ok) {
        return { success: true, message: 'Email sent via Resend' };
      } else {
        const errText = await response.text();
        console.error('Resend error response:', errText);
      }
    } catch (err: any) {
      console.error('Failed to send email via Resend:', err);
    }
  }

  // Option 2: SMTP Transport
  if (process.env.SMTP_HOST) {
    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      await transporter.sendMail({
        from: process.env.SMTP_FROM || '"Flashcard App" <no-reply@localhost>',
        to,
        subject,
        html,
      });

      return { success: true, message: 'Email sent via SMTP' };
    } catch (err: any) {
      console.error('Failed to send email via SMTP:', err);
    }
  }

  // Option 3: Local Fallback Logger (No API Key or SMTP Setup)
  const logDir = path.join(process.cwd(), 'prisma');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const logFilePath = path.join(logDir, 'sent_emails.log');
  const emailLogEntry = `
=========================================
TIMESTAMP: ${new Date().toISOString()}
TO: ${to}
SUBJECT: ${subject}
HTML:
${html}
=========================================
`;

  fs.appendFileSync(logFilePath, emailLogEntry, 'utf-8');
  console.log(`[Email Simulator] Email to ${to} logged to: prisma/sent_emails.log`);
  
  return { 
    success: true, 
    message: 'Email logged to prisma/sent_emails.log (simulation mode)' 
  };
}

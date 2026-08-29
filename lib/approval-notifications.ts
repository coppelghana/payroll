import "server-only";

import { db } from "@/lib/db";

type EmailNotification = {
  id: string;
  recipient_email: string;
  title: string;
  message: string;
  period_code: string;
  action_url: string;
};

function emailConfiguration() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.PAYROLL_EMAIL_FROM?.trim();
  const appUrl = (process.env.PAYROLL_APP_URL?.trim() || "https://payroll.coppelafrica.com").replace(/\/$/, "");
  return apiKey && from ? { apiKey, from, appUrl } : null;
}

export function approvalEmailConfigured() {
  return Boolean(emailConfiguration());
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character]!);
}

function emailHtml(notification: EmailNotification, approvalUrl: string) {
  return `<!doctype html><html><body style="margin:0;background:#f3f6fa;font-family:Arial,sans-serif;color:#162033"><div style="max-width:600px;margin:0 auto;padding:36px 20px"><div style="background:#10233f;color:#fff;padding:20px 24px;border-radius:12px 12px 0 0"><strong style="font-size:18px">Coppel Payroll</strong><div style="font-size:12px;color:#bfd0e4">Approval notification</div></div><div style="background:#fff;border:1px solid #e1e7ef;border-top:0;padding:28px 24px;border-radius:0 0 12px 12px"><h1 style="font-size:22px;margin:0 0 14px">${escapeHtml(notification.title)}</h1><p style="line-height:1.6;margin:0 0 22px">${escapeHtml(notification.message)}</p><a href="${escapeHtml(approvalUrl)}" style="display:inline-block;background:#1a73e8;color:#fff;text-decoration:none;font-weight:700;padding:11px 16px;border-radius:8px">Open payroll approvals</a><p style="font-size:12px;color:#667085;margin:24px 0 0">This message contains no salary figures. Sign in to the protected payroll system to review the record.</p></div></div></body></html>`;
}

export async function deliverApprovalEmails(periodId: string | null = null) {
  const configuration = emailConfiguration();
  if (!configuration) return { configured: false, sent: 0, failed: 0 };

  const sql = db();
  const notifications = await sql`WITH candidates AS (
    SELECT id FROM approval_notifications
    WHERE (${periodId}::uuid IS NULL OR period_id=${periodId}::uuid)
      AND (email_status IN ('pending','failed') OR (email_status='sending' AND email_attempted_at<now()-interval '15 minutes'))
      AND email_attempts<5
    ORDER BY created_at
    LIMIT 50
  )
  UPDATE approval_notifications n
  SET email_status='sending',email_attempts=n.email_attempts+1,email_attempted_at=now(),email_error=NULL
  FROM candidates c
  WHERE n.id=c.id
  RETURNING n.id,n.recipient_email,n.title,n.message,n.action_url,
    (SELECT period_code FROM payroll_periods WHERE id=n.period_id) AS period_code` as EmailNotification[];

  let sent = 0;
  let failed = 0;

  for (const notification of notifications) {
    const approvalUrl = `${configuration.appUrl}${notification.action_url}`;
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${configuration.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `approval-notification-${notification.id}`,
        },
        body: JSON.stringify({
          from: configuration.from,
          to: [notification.recipient_email],
          subject: `[Coppel Payroll] ${notification.title} — ${notification.period_code}`,
          html: emailHtml(notification, approvalUrl),
          text: `${notification.title}\n\n${notification.message}\n\nOpen payroll approvals: ${approvalUrl}`,
        }),
      });
      const data = await response.json() as { id?: string; message?: string };
      if (!response.ok) throw new Error(data.message || `Email service returned ${response.status}`);
      await sql`UPDATE approval_notifications
        SET email_status='sent',email_sent_at=now(),email_message_id=${data.id || null},email_error=NULL
        WHERE id=${notification.id} AND email_status='sending'`;
      sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Email delivery failed";
      await sql`UPDATE approval_notifications
        SET email_status='failed',email_error=${message.slice(0,500)}
        WHERE id=${notification.id} AND email_status='sending'`;
      failed += 1;
    }
  }

  return { configured: true, sent, failed };
}

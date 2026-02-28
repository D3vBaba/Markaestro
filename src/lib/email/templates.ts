/**
 * Simple HTML email template engine with personalization tokens.
 */

const DEFAULT_TEMPLATE = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background: #f9fafb; }
    .wrapper { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
    .card { background: #ffffff; border-radius: 8px; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .header { font-size: 24px; font-weight: 600; color: #111827; margin-bottom: 16px; }
    .body { font-size: 16px; line-height: 1.6; color: #374151; }
    .cta { display: inline-block; margin-top: 24px; padding: 12px 24px; background: #111827; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 500; }
    .footer { margin-top: 32px; font-size: 12px; color: #9ca3af; text-align: center; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="header">{{subject}}</div>
      <div class="body">{{body}}</div>
      {{#cta}}<a href="{{ctaUrl}}" class="cta">{{ctaText}}</a>{{/cta}}
    </div>
    <div class="footer">
      Sent via Markaestro &bull; <a href="{{unsubscribeUrl}}" style="color:#9ca3af">Unsubscribe</a>
    </div>
  </div>
</body>
</html>
`.trim();

export type TemplateVars = {
  subject?: string;
  body?: string;
  ctaText?: string;
  ctaUrl?: string;
  recipientName?: string;
  recipientEmail?: string;
  unsubscribeUrl?: string;
  [key: string]: string | undefined;
};

/**
 * Render an email template with personalization variables.
 * Supports {{variable}} and {{#cta}}...{{/cta}} conditional blocks.
 */
export function renderTemplate(vars: TemplateVars, template?: string): string {
  let html = template || DEFAULT_TEMPLATE;

  // Handle conditional blocks: {{#key}}...{{/key}}
  html = html.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_match, key, content) => {
    return vars[key] ? content : '';
  });

  // Replace variables: {{key}}
  html = html.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
    return vars[key] || '';
  });

  return html;
}

/**
 * Generate a plain-text version from the HTML body.
 */
export function toPlainText(body: string): string {
  return body.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

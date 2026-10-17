# Zaptech Australia website

Responsive website built from the approved charcoal-and-mint design. No build step is required. Vercel installs Nodemailer from the pinned dependency and serves the frontend and the Node.js function at `/api/contact`.

## Contact

- Phone: 03 4150 7515 (`tel:+61341507515`).
- Email: contact@zaptech.com.au.
- With Postmark configured, enquiries submit directly to `/api/contact`, which sends a transactional email from Zaptech Australia <contact@zaptech.com.au> to contact@zaptech.com.au. The visitor's email is set as Reply-To. The destination and sender cannot be overridden by visitors.
- The page checks sending availability without exposing credentials. Until the token is configured (or if that initial check fails), the existing email-app flow remains available and clearly labelled. JavaScript-disabled visitors can use the email-app form or direct email link.
- SMTP is the default, connecting to smtp.postmarkapp.com on port 587 with mandatory STARTTLS. The existing Server API Token is reused as username and password. Enable SMTP access in Postmark's server settings. Set POSTMARK_TRANSPORT=api and redeploy to use the previous REST path.
- Success is shown only after SMTP returns a 250 acceptance for the fixed recipient, or REST returns ErrorCode 0 with Message OK. This confirms acceptance, not inbox delivery. Errors preserve entered fields. Requests are not automatically retried or switched between transports, to avoid duplicate emails.
- With SMTP, the success reference is an application-generated enquiry ID included in the email, Message-ID header and Postmark metadata; it is not Postmark's REST MessageID. With REST, the reference remains Postmark's MessageID. Private runtime logs record transport acceptance/reference or safe error codes without credentials or enquiry content. `/api/contact?check=server` performs a REST authentication check and reports only server ID and delivery type, never tokens, hooks or message content. It does not test SMTP availability. Compare the ID to the server shown in Postmark; sandbox servers do not deliver real mail.
- Clicking a service selects it in the contact form.

## JetEmail activation

The verified JetEmail domain can send using SMTP on port 587 with mandatory STARTTLS. Create an SMTP user allowed to send from zaptech.com.au, then save JETEMAIL_SMTP_HOST (the exact host shown in JetEmail), JETEMAIL_SMTP_USERNAME and JETEMAIL_SMTP_PASSWORD as Production environment variables in Vercel. Redeploy. Do not put credentials in source code or chat. When these three values are present, JetEmail is selected instead of Postmark; partial configuration disables sending to avoid silently using the wrong provider. No automatic provider fallback or retries occur. The email recipient, reply-to behavior, spam checks, private acceptance logs and application reference are retained. Confirm delivery with an authorised live test. Domain verification alone does not activate this connection.

## Postmark setup (previous provider)

1. Use a Postmark server with live transactional sending approved and zaptech.com.au verified. The standard `outbound` transactional message stream is used.
2. In Vercel project `website`, add **POSTMARK_SERVER_TOKEN** as a sensitive Production environment variable. Use a **Server API Token**, not the account-management token. Do not put the real value into a file, source code, browser script, commit, chat or screenshot.
3. Redeploy after adding or changing the variable. Environment changes do not modify existing deployments.
4. Check `/api/contact`: `{"enabled":true}` means a nonempty live token is present. This does not verify token validity or delivery. A Postmark test token is deliberately not treated as live configuration.
5. Submit a clearly labelled test enquiry to contact@zaptech.com.au, confirm Postmark acceptance, and verify inbox receipt. No automatic reply is sent to the visitor.

Both https://zaptech.com.au and https://www.zaptech.com.au are allowed for contact submissions by default, together with website-zaptech1.vercel.app and Vercel's current deployment and project production URLs. For any additional custom domains, set CONTACT_ALLOWED_ORIGINS to exact HTTPS origins (comma-separated). No email DNS changes are needed for this form if the sending domain is already verified.

## Validation and spam checks

The function enforces POST + JSON for submissions, checks the request origin, bounds payload and field sizes, restricts service names, rejects header-control characters, uses a hidden honeypot and minimum form completion time, and applies a best-effort per-instance throttle (five valid attempts per IP per ten minutes). IPs are hashed in memory and not logged. This throttle is not distributed and can reset with server instances; Vercel Firewall rate limiting or a verified challenge can be added if spam volume warrants it. Email contents are sent as plain text and are not stored by this application.

Install dependencies with pnpm install --frozen-lockfile. Run tests with `node --test tests/contact.test.js tests/form.test.js`. Tests mock both Postmark sending methods; they send no email.

## Hosting

The custom domain is https://www.zaptech.com.au, with https://zaptech.com.au redirecting to it. The original https://website-zaptech1.vercel.app address remains available. Commits to the main branch of VultureAUS/VultureAUS deploy automatically through the existing Vercel project. The owner configured the custom domains in Vercel; the application allows contact submissions from both.

The static design can render on other hosts, but direct Postmark submission requires the Vercel Node.js function and environment variable. Existing unrelated repository files are preserved.

## Brand and content

Name: Zaptech Australia. Headline: “Get cracking. Keep growing.” Supporting line: “Practical technology, built around your business.” Audience: Australian small and medium businesses.

The ZA mark is recreated as scalable vector geometry from the supplied logo, preserving its angular silhouette and recolouring it mint. The large hero treatment uses the same shape as an outline.

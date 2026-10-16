# Zaptech Australia website

Responsive website built from the approved charcoal-and-mint design. No build step or external packages are required. Vercel serves the frontend and the Node.js function at `/api/contact`.

## Contact

- Phone: 03 4150 7515 (`tel:+61341507515`).
- Email: contact@zaptech.com.au.
- With Postmark configured, enquiries submit directly to `/api/contact`, which sends a transactional email from Zaptech Australia <contact@zaptech.com.au> to contact@zaptech.com.au. The visitor's email is set as Reply-To. The destination and sender cannot be overridden by visitors.
- The page checks sending availability without exposing credentials. Until the token is configured (or if that initial check fails), the existing email-app flow remains available and clearly labelled. JavaScript-disabled visitors can use the email-app form or direct email link.
- Success is shown only after Postmark accepts the email with ErrorCode 0. Errors preserve entered fields. Requests are not automatically retried after network errors, to avoid duplicate emails.
- Clicking a service selects it in the contact form.

## Postmark activation

1. Use a Postmark server with live transactional sending approved and zaptech.com.au verified. The standard `outbound` transactional message stream is used.
2. In Vercel project `website`, add **POSTMARK_SERVER_TOKEN** as a sensitive Production environment variable. Use a **Server API Token**, not the account-management token. Do not put the real value into a file, source code, browser script, commit, chat or screenshot.
3. Redeploy after adding or changing the variable. Environment changes do not modify existing deployments.
4. Check `/api/contact`: `{"enabled":true}` means a nonempty live token is present. This does not verify token validity or delivery. A Postmark test token is deliberately not treated as live configuration.
5. Submit a clearly labelled test enquiry to contact@zaptech.com.au, confirm Postmark acceptance, and verify inbox receipt. No automatic reply is sent to the visitor.

If a custom domain is added, set `CONTACT_ALLOWED_ORIGINS` to its exact HTTPS origins (comma-separated). The existing website-zaptech1.vercel.app host and Vercel's current deployment and project production URLs are allowed automatically. No DNS changes are needed for this form if the sending domain is already verified.

## Validation and spam checks

The function enforces POST + JSON for submissions, checks the request origin, bounds payload and field sizes, restricts service names, rejects header-control characters, uses a hidden honeypot and minimum form completion time, and applies a best-effort per-instance throttle (five valid attempts per IP per ten minutes). IPs are hashed in memory and not logged. This throttle is not distributed and can reset with server instances; Vercel Firewall rate limiting or a verified challenge can be added if spam volume warrants it. Email contents are sent as plain text and are not stored by this application.

Run tests with `node --test tests/contact.test.js tests/form.test.js`. Tests mock Postmark; they send no email.

## Hosting

The live site is `https://website-zaptech1.vercel.app`. Commits to the main branch of VultureAUS/VultureAUS deploy automatically through the existing Vercel project. No custom domain or DNS changes are included.

The static design can render on other hosts, but direct Postmark submission requires the Vercel Node.js function and environment variable. Existing unrelated repository files are preserved.

## Brand and content

Name: Zaptech Australia. Headline: “Get cracking. Keep growing.” Supporting line: “Practical technology, built around your business.” Audience: Australian small and medium businesses.

The ZA mark is recreated as scalable vector geometry from the supplied logo, preserving its angular silhouette and recolouring it mint. The large hero treatment uses the same shape as an outline.

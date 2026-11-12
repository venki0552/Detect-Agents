# Integration guide

Read `THREAT-MODEL.md` → "The honest summary" first. The short version: the verdict is a risk signal computed from data the browser supplies. It decides how much friction an action gets. It is not, on its own, an authorization for an irreversible action.

## 1. Browser

```html
<script src="/agent-detect.js"></script>
<script>
  const ad = AgentDetect.AgentDetect.init({
    endpoint: '/ad',                 // same origin as your app
    appRoots: ['#app'],              // nodes injected outside these count as foreign
    agentMarkers: [],                // CSS selectors of known agent overlays
    // maskSelectors: ['[data-ad-mask]'],   // default: regions where nothing is measured (PIN pads)
    // autofillFields: ['#login-id'],       // extra fields a password manager fills by script
  });

  // Optional honeypot inside forms (invisible, aria-hidden, skipped by autofill and password managers)
  document.querySelector('#transfer-form').appendChild(AgentDetect.AgentDetect.canaryField());

  // Before any sensitive action: bind the decision to THIS transaction.
  const ctx = await AgentDetect.AgentDetect.contextHash(payeeId, amount, currency);
  const { decision, token } = await ad.decide('transfer', ctx);
  // decision: 'allow' | 'notify' | 'step_up' | 'block'   (any failure to reach the server is 'step_up')
  // Send `token` with the API request, e.g. header X-Agent-Detect.
</script>
```

ES module build: `import AgentDetect from 'agent-detect/client'`.

**Markup you need to get right:**

| Do this | Why |
|---|---|
| Put `data-ad-mask` on on-screen PIN pads, virtual keyboards and security-code grids | A click position on a keypad is the digit. Inside a mask the collector records no click geometry, pointer path or key timing |
| Give login and identity fields their `autocomplete` token **in the markup you render** (the collector classifies a field once, when it first appears; an attribute added later is ignored) (`username`, `current-password`, `one-time-code`, `cc-number`, …), or list them in `autofillFields` | Password-manager extensions fill by script. Those events are `isTrusted=false`; on a field the collector recognises as a credential field they are ignored, anywhere else they are Tier 1 (`block`) |
| Do **not** put an identity `autocomplete` token on amount, payee or memo fields | That would exempt script fills of exactly the fields an attacker needs |
| Keep your own code off `innerHTML`-style sinks where you can | The collector ignores reports from your own scripts, but every one you avoid is one less thing to reason about |

**Headers for pages that load the SDK:**

```
Content-Security-Policy-Report-Only: require-trusted-types-for 'script'
```

This blocks nothing; it enables the `dom.injected_html` signal. It's exported as `TRUSTED_TYPES_REPORT_ONLY`.

## 2. Node backend

```ts
import http from 'node:http';
import { createAgentDetect, contextHash } from 'agent-detect/server';

const ad = createAgentDetect({
  secret: process.env.AD_SECRET!,     // >= 32 random characters. [newSecret, oldSecret] rotates.
  policy: {                           // unknown actions are 'high'; an invalid value refuses to start
    view_balance: 'low',
    update_profile: 'medium',
    add_payee: 'high',
    change_password: 'high',
    transfer: 'critical',             // always needs the account holder, whatever the verdict
  },
  bind: (req) => appSessionId(req),   // YOUR authenticated session id (or null → 401)
  onDecision: (e) => auditLog.write(e),
});

http.createServer(async (req, res) => {
  if (await ad.handle(req, res)) return;   // /ad/session, /ad/collect, /ad/decide
  // ... your app
});
```

In the API that performs the action, **one call**:

```ts
// Recompute the context from the request you are about to execute — never take it from the client.
const ctx = contextHash(body.payeeId, body.amount, body.currency);
const a = ad.authorize(String(req.headers['x-agent-detect'] || ''), {
  action: 'transfer',
  ctx,
  req,                                  // its binding must match the token's
  stepUpVerified: passkeyAssertionOk,   // true only after YOUR server verified a fresh passkey assertion
});
if (!a.ok) return res.writeHead(403).end();   // a.reason: invalid | action | ctx | binding | decision | replayed | busy
```

`authorize()` checks, in order: signature and expiry, the action, the transaction context (in both directions), the session binding, the decision, and that this token has not been used before. `verifyToken()` checks only the signature, expiry and shape: use it for inspection, not for authorization.

### Choosing sensitivities

| Level | Use for | Behaviour |
|---|---|---|
| `low` | Reads | Always proceeds; Tier 1 or `agent` adds an out-of-band alert |
| `medium` | Reversible changes | **Only holds against agents that do not manipulate their telemetry.** A client that sends a little, plausible telemetry is `unknown`, which is `allow` here |
| `high` | Sensitive actions where occasional friction is acceptable | Steps up unless the verdict is `human` |
| `critical` | Money movement, new payees above a limit, credential and contact changes | **Always** steps up (or blocks on Tier 1). Use this for anything you could not undo |

### What `bind` should return

The id of the caller's authenticated session: the same thing your API uses to know who is calling. With it, there is one detection session per app session (asking for a "new" one returns the same one), and a token is only valid in the session that earned it. Without it, both of those protections are off. On pre-login pages, bind to your pre-auth session id.

## 3. Non-Node backends (sidecar)

Run the server module as a small Node service, routed under the same origin as `/ad/*` by your gateway. Until the sidecar exposes an `authorize` endpoint (roadmap), your API verifies tokens itself, and **must do all of this**:

1. Verify the signature (below) and that the token has exactly two dot-separated parts.
2. `exp` is in the future.
3. `action` equals the action this endpoint performs.
4. `ctx` equals the context you recompute from the request: `base64url(SHA-256(parts joined by "\n"))`. Reject if either side has a context and the other does not.
5. `sub` equals `base64url(HMAC-SHA256(secret, "agent-detect/sub\n" + bindingValue))` truncated to 22 characters, for the caller's own session.
6. `decision` is `allow` or `notify`; or `step_up` and you have verified a passkey assertion for this transaction. Never `block`.
7. `jti` has not been seen before (store it until `exp`).

Skipping 4, 5 or 7 reopens the token-reuse and token-relay holes described in `DECISIONS.md` D18–D19.

**Token format:** `<body>.<mac>`, where
- `body = base64url(UTF-8 JSON {"v":1, "jti": string, "iat": unix-seconds, "exp": unix-seconds, "sid": string|null, "sub"?: string, "action": string, "decision": "allow"|"notify"|"step_up"|"block", "ctx"?: string})`
- `mac = base64url(HMAC-SHA256(secret, body))`, computed over the **base64url text** of `body`

The snippets below do step 1 only.

### Java

```java
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;

public final class AgentDetectToken {
  /** Returns the JSON payload if valid; null if forged or malformed. Check exp, action and decision in the caller. */
  public static String verify(String token, byte[] secret) throws Exception {
    int dot = token == null ? -1 : token.indexOf('.');
    if (dot <= 0) return null;
    String body = token.substring(0, dot);
    byte[] got = Base64.getUrlDecoder().decode(token.substring(dot + 1));
    Mac mac = Mac.getInstance("HmacSHA256");
    mac.init(new SecretKeySpec(secret, "HmacSHA256"));
    byte[] want = mac.doFinal(body.getBytes(StandardCharsets.US_ASCII));
    if (!MessageDigest.isEqual(got, want)) return null;          // constant-time compare
    return new String(Base64.getUrlDecoder().decode(body), StandardCharsets.UTF_8);
  }
}
// Then parse the JSON (Jackson/Gson) and require:
//   exp * 1000 > System.currentTimeMillis(), action equals the endpoint's action, decision equals "allow".
```

### .NET (C#)

```csharp
using System.Security.Cryptography; using System.Text;
static string? Verify(string token, byte[] secret) {
  var dot = token?.IndexOf('.') ?? -1; if (dot <= 0) return null;
  var body = token![..dot];
  static byte[] B64U(string s) { s = s.Replace('-', '+').Replace('_', '/'); return Convert.FromBase64String(s.PadRight(s.Length + (4 - s.Length % 4) % 4, '=')); }
  using var h = new HMACSHA256(secret);
  var want = h.ComputeHash(Encoding.ASCII.GetBytes(body));
  if (!CryptographicOperations.FixedTimeEquals(B64U(token[(dot + 1)..]), want)) return null;
  return Encoding.UTF8.GetString(B64U(body));   // then check exp, action, decision
}
```

The Java version was compiled and tested against v0.2 tokens (valid → payload; tampered or wrong key → null); the signature scheme is unchanged in v0.3 but it has not been re-run. The C# version hasn't been compiled. Neither implements steps 2–7.

## 4. Wiring the decisions

| Decision | What the app should do |
|---|---|
| `allow` | Proceed; send the token to the API |
| `notify` | Proceed, send the token to the API (`authorize()` accepts it), **and** send an out-of-band alert to the customer's registered app. Never show it in the page |
| `step_up` | **The SDK's job ends here: it tells you a step-up is needed.** How you perform it is yours (passkey, approval in your app, whatever your bank already uses). Requirements on your side: it must be something the agent in the browser cannot complete, it must be tied to this transaction (derive its challenge from the token's `jti` and `ctx`), and your server must verify it. Then call the API with the same token and `stepUpVerified: true` |
| `block` | Stop. Show a neutral message ("This request was stopped. If this wasn't you, open the bank app."). Alert out-of-band |

Do not "call `decide` again" after a step-up: the telemetry has not changed and the answer will be the same.

**No polling is needed.** A step-up only ever arises at the moment of a user action, so it travels on that action's own request and response: the page (today) or your API (planned, roadmap P0 #1) gets the decision while handling the click, and the UI reacts to the reply. Push or polling is only for things that happen away from the page: the out-of-band `notify`, or an approval on another device.

## 5. Production checklist

Configuration:
- `secret` is ≥ 32 random characters from your secret manager, with a rotation plan (`[new, old]`).
- `bind` is set.
- Every money-moving or account-changing action is `critical` or `high`; nothing that matters is `medium`.
- The API uses `authorize()` with `ctx` recomputed server-side.
- `exposeReasons: false`, `debug: false` (the module refuses to start otherwise when `NODE_ENV=production`).
- `maxSessions` sized for memory: budget about 1.5 MB per session worst case.
- `maxUsedTokensPerPrincipal` (default 2,000 spent tokens per session per token lifetime) left at a value no real user reaches.
- `basePath` chosen so ad blockers do not block it (the default `/ad` has not been verified against filter lists).

Around it:
- Rate limiting on `/ad/*`, per IP and per session. **Not provided by this product, by decision** (D30): the endpoints assume your infrastructure does it.
- A single instance, or wait for the shared store: sessions, latched evidence and the token replay cache are in memory.
- Your step-up mechanism, wired to `stepUpVerified` (the SDK signals the need; it does not perform the step-up).
- `data-ad-mask` on any on-screen keypad; `autocomplete` tokens on login fields.
- Start in shadow mode and calibrate (`docs/CALIBRATION.md`).
- Privacy notice, legal review and retention policy (`docs/PRIVACY.md`).
- The collector script served from your own origin, with Subresource Integrity if it is served from anywhere else.

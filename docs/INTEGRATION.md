# Integration guide

## 1. Browser

```html
<script src="/agent-detect.js"></script>
<script>
  const ad = AgentDetect.AgentDetect.init({
    endpoint: '/ad',                 // same origin as your app
    appRoots: ['#app'],              // nodes injected outside these count as foreign
    agentMarkers: [],                // CSS selectors of known agent overlays
  });

  // Optional honeypot inside forms (invisible, aria-hidden, skipped by autofill)
  document.querySelector('#transfer-form').appendChild(AgentDetect.AgentDetect.canaryField());

  // Before any sensitive action:
  const { decision, token } = await ad.decide('transfer');
  // decision: 'allow' | 'notify' | 'step_up' | 'block'
  // Send `token` with the API request, e.g. header X-Agent-Detect.
</script>
```

ES module build: `import AgentDetect from 'agent-detect/client'`.

**Headers for pages that load the SDK:**

```
Content-Security-Policy-Report-Only: require-trusted-types-for 'script'
```

This blocks nothing; it enables the `dom.injected_html` signal. It's exported as `TRUSTED_TYPES_REPORT_ONLY`. Your own code should avoid `innerHTML`-style sinks; its reports are ignored as `page`.

## 2. Node backend

```ts
import http from 'node:http';
import { createAgentDetect } from 'agent-detect/server';

const ad = createAgentDetect({
  secret: process.env.AD_SECRET!,     // >= 32 random bytes
  policy: {                           // unknown actions default to 'high'
    view_balance: 'low',
    update_profile: 'medium',
    transfer: 'high',
    add_payee: 'high',
    change_password: 'high',
  },
  onDecision: (e) => auditLog.write(e),
});

http.createServer(async (req, res) => {
  if (await ad.handle(req, res)) return;   // /ad/session, /ad/collect, /ad/decide
  // ... your app
});
```

In the API that performs the action:

```ts
const p = ad.verifyToken(String(req.headers['x-agent-detect'] || ''));
if (!p || p.action !== 'transfer' || p.decision !== 'allow') {
  return res.writeHead(403).end();
}
```

## 3. Non-Node backends (sidecar)

Run the server module as a small Node service, routed under the same origin as `/ad/*` by your gateway. Share the HMAC secret with your API, which verifies tokens itself.

**Token format:** `<body>.<mac>`, where
- `body = base64url(UTF-8 JSON {"sid": string|null, "action": string, "decision": "allow"|"notify"|"step_up"|"block", "exp": unix-seconds})`
- `mac = base64url(HMAC-SHA256(secret, body))`, computed over the **base64url text** of `body`

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

The Java version was compiled and tested against tokens from this server (valid → payload; tampered or wrong key → null). The C# version hasn't been compiled yet. Roadmap item 7 adds tested verifiers for more languages with shared test vectors.

## 4. Wiring the decisions

| Decision | What the app should do |
|---|---|
| `allow` | Proceed; send the token to the API |
| `notify` | Proceed (or for medium actions, per your policy) and send an **out-of-band** alert to the customer's registered app. Never show it in the page |
| `step_up` | Run passkey reauthentication (WebAuthn with `allowCredentials` limited to the signed-in user), then call `decide` again or have the server issue an `allow` after verifying the assertion |
| `block` | Stop. Show a neutral message ("This request was stopped. If this wasn't you, open the bank app."). Alert out-of-band |

## 5. Production checklist

- Random `secret` (≥ 32 bytes) from your secret manager; rotate it.
- Redis (or similar) session store for more than one instance (roadmap item 5).
- `exposeReasons: false`, `debug: false`.
- Start in shadow mode (`docs/CALIBRATION.md`).
- Privacy notice and retention policy (`docs/PRIVACY.md`).

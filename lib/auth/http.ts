import { bindings, database } from "@/lib/db/client";
import { assertCsrf, assertOrigin } from "@/lib/security/request-policy";
import { siteOrigin } from "@/lib/security/env";
import { requireSession, requestSessionToken } from "./session";

export async function adminRequest(request: Request, options: { write?: boolean; csrfToken?: string } = {}) {
  const db = database();
  const context = await requireSession(db, requestSessionToken(request), Date.now());
  if (options.write) {
    assertOrigin(request, siteOrigin(bindings()));
    await assertCsrf(options.csrfToken ?? request.headers.get("X-CSRF-Token"), context.csrfDigest);
  }
  return { db, context };
}

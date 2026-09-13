import { adminRequest } from "@/lib/auth/http";
import { rotateCsrf } from "@/lib/auth/session";
import { errorResponse, jsonResponse } from "@/lib/security/errors";

export async function GET(request: Request) {
  try {
    const { db, context } = await adminRequest(request);
    return jsonResponse({ username: context.username, csrfToken: await rotateCsrf(db, context, Date.now()), expiresAt: new Date(context.expiresAt).toISOString() });
  } catch (error) { return errorResponse(error); }
}

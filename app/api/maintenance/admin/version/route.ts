import { maintenanceRequest } from "@/lib/auth/maintenance-http";
import { errorResponse, jsonResponse } from "@/lib/security/errors";

export async function GET(request: Request) {
  try {
    const { db } = await maintenanceRequest(request);
    const account = await db.prepare("SELECT credential_version FROM admin_accounts WHERE id=1").first<{credential_version:number}>();
    return jsonResponse({ initialized: !!account, credentialVersion: account?.credential_version ?? null });
  } catch (error) { return errorResponse(error); }
}

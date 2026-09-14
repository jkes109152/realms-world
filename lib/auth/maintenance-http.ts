import { bindings, database } from "@/lib/db/client";
import { digest, equalSecret, validSecret } from "@/lib/security/crypto-box";
import { AppError } from "@/lib/security/errors";

export async function maintenanceRequest(request: Request) {
  const token = bindings().MAINTENANCE_TOKEN;
  const supplied = request.headers.get("Authorization")?.replace(/^Bearer /, "");
  if (!validSecret(token) || !validSecret(supplied) || !equalSecret(token, supplied) || request.headers.has("Origin")) throw new AppError("not_found", 404);
  return { db: database(), operationDigest: await digest(token) };
}

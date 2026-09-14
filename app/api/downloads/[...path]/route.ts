import { bindings } from "@/lib/db/client";
import { downloadsRequest } from "@/lib/downloads/public-api";
type Context = { params: Promise<{path:string[]}> };
export async function GET(request: Request, context: Context) { return downloadsRequest(request, (await context.params).path, bindings()); }
export const POST = GET;

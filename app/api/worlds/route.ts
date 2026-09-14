import { bindings } from "@/lib/db/client";
import { worldsRequest } from "@/lib/downloads/public-api";
export async function GET(request: Request) { return worldsRequest(request, [], bindings()); }
